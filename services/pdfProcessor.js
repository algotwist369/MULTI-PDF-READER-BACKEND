const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const Invoice = require('../models/Invoice');
require('dotenv').config();

class PdfProcessor {
    constructor() {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        this.llm = new ChatOpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            model: 'gpt-4o-mini',
            temperature: 0.1,
            maxOutputTokens: 2000
        });
    }

    async processPdf(file) {
        let invoice = null;

        try {
            // Create initial invoice record
            invoice = new Invoice({
                fileName: file.originalname,
                filePath: file.path,
                platform: 'other',
                status: 'processing'
            });
            await invoice.save();

            // Read and parse PDF
            const pdfBuffer = await fs.readFile(file.path);
            const pdfData = await pdfParse(pdfBuffer);
            const textContent = pdfData.text;

            // Store raw text
            invoice.rawText = textContent;
            await invoice.save();

            // Detect platform
            const platform = this.detectPlatform(textContent);
            invoice.platform = platform;

            // Extract data using LLM (with regex fallback)
            const extractedData = await this.extractInvoiceData(textContent, platform);

            // Update invoice
            invoice.extractedData = extractedData;
            invoice.status = 'completed';
            await invoice.save();

            return {
                fileName: file.originalname,
                platform,
                extractedData,
                status: 'completed'
            };
        } catch (error) {
            console.error(`Error processing ${file.originalname}:`, error);
            if (invoice) {
                invoice.status = 'failed';
                invoice.errorMessage = error.message;
                await invoice.save();
            }
            throw error;
        }

    }

    detectPlatform(text) {
        const lowercaseText = text.toLowerCase();

        if (lowercaseText.includes('google ads') || lowercaseText.includes('google invoice')) {
            return 'google_ads';
        }
        if (lowercaseText.includes('meta') && (lowercaseText.includes('ads') || lowercaseText.includes('advertising'))) {
            return 'meta_ads';
        }
        if (lowercaseText.includes('facebook ads')) {
            return 'facebook_ads';
        }
        if (lowercaseText.includes('instagram ads')) {
            return 'instagram_ads';
        }
        return 'other';
    }

    async extractInvoiceData(text, platform) {
        const systemPrompt = this.getSystemPrompt(platform);
        const messages = [
            new SystemMessage(systemPrompt),
            new HumanMessage(`Extract invoice data from this ${platform} invoice text:\n\n${text}`)
        ];

        try {
            const response = await this.llm.invoke(messages);
            let extractedData = {};
            try {
                extractedData = JSON.parse(response.content || response.text || "{}");
            } catch {
                console.warn("LLM returned invalid JSON, using fallback extraction.");
                extractedData = this.basicExtraction(text, platform);
            }
            return this.validateAndFormatData(extractedData, platform, text);
        } catch (error) {
            console.error('Error extracting data with LLM:', error);
            return this.basicExtraction(text, platform);
        }
    }

    getSystemPrompt(platform) {
        if (platform === 'google_ads') {
            return `
You are an expert at extracting structured data from Google Ads invoices.
Return ONLY valid JSON:

{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "accountName": "string",
  "accountId": "string",
  "location": "string",
  "billingPeriod": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" },
  "subtotal": number,
  "taxAmount": number,
  "totalAmount": number,
  "currency": "INR",
  "campaigns": [
    { "campaignName": "string", "clicks": number, "cpc": number, "amount": number }
  ]
}

Rules:
- Extract accountName & location from "Bill to"
- Extract accountId from "Account:" line
- Extract campaigns from "Description ... Clicks ... Amount" lines
- Dates must be YYYY-MM-DD
- If missing, set null
`;
        }

        if (platform === 'meta_ads') {
            return `
You are an expert at extracting structured data from Meta Ads invoices.
Return ONLY valid JSON:

{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "accountId": "string",
  "billingPeriod": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" },
  "subtotal": number,
  "taxAmount": number,
  "totalAmount": number,
  "currency": "INR",
  "campaigns": [
    { "campaignName": "string", "impressions": number, "amount": number }
  ]
}

Rules:
- Campaign impressions are in the invoice text
- Dates must be YYYY-MM-DD
- If missing, set null
`;
        }

        return `Return valid JSON with basic invoice fields.`;
    }

    validateAndFormatData(data, platform, text) {
        const validated = {};
        validated.invoiceNumber = data.invoiceNumber || null;
        validated.invoiceDate = (data.invoiceDate && !isNaN(Date.parse(data.invoiceDate)))
            ? new Date(data.invoiceDate) : null;
        validated.accountId = data.accountId || null;
        validated.accountName = data.accountName || null;
        validated.location = data.location || null;

        if (data.billingPeriod) {
            validated.billingPeriod = {
                startDate: (data.billingPeriod.startDate && !isNaN(Date.parse(data.billingPeriod.startDate)))
                    ? new Date(data.billingPeriod.startDate) : null,
                endDate: (data.billingPeriod.endDate && !isNaN(Date.parse(data.billingPeriod.endDate)))
                    ? new Date(data.billingPeriod.endDate) : null
            };
        }

        validated.subtotal = this.toNumber(data.subtotal);
        validated.taxAmount = this.toNumber(data.taxAmount);
        validated.totalAmount = this.toNumber(data.totalAmount);
        validated.currency = data.currency || "INR";

        // Campaigns
        validated.campaigns = [];
        if (Array.isArray(data.campaigns) && data.campaigns.length > 0) {
            data.campaigns.forEach(c => {
                const campaign = {
                    campaignName: c.campaignName || null,
                    amount: this.toNumber(c.amount)
                };

                if (platform === "google_ads") {
                    campaign.clicks = this.toNumber(c.clicks);
                    campaign.cpc = (campaign.clicks && campaign.amount)
                        ? parseFloat((campaign.amount / campaign.clicks).toFixed(2))
                        : null;
                }

                if (platform === "meta_ads") {
                    campaign.impressions = this.toNumber(c.impressions);
                }

                validated.campaigns.push(campaign);
            });
        } else {
            // fallback campaign extraction for google
            if (platform === "google_ads") {
                validated.campaigns = this.extractCampaigns(text);
            }
        }

        return validated;
    }

    basicExtraction(text, platform = "other") {
        if (platform === "google_ads") {
            return {
                invoiceNumber: this.extractPattern(text, /Invoice number[:\s]+(\d{6,})/i),
                invoiceDate: this.extractPattern(text, /(\d{1,2}\s+\w+\s+20\d{2})/i),
                accountId: this.extractPattern(text, /Account ID[:\s]+([\d-]+)/i),
                accountName: this.extractPattern(text, /Account:\s+([^\n]+)/i),
                location: this.extractPattern(text, /Bill to\s+([\s\S]*?)India/i),
                subtotal: this.extractMonetaryValue(text, /Subtotal in INR\s+₹?([\d,]+\.\d{2})/i),
                taxAmount: this.extractMonetaryValue(text, /(Integrated GST.*?|IGST.*?)\s+₹?([\d,]+\.\d{2})/i, 2),
                totalAmount: this.extractMonetaryValue(text, /Total in INR\s+₹?([\d,]+\.\d{2})/i),
                currency: "INR",
                campaigns: this.extractCampaigns(text)
            };
        }

        return {
            invoiceNumber: this.extractPattern(text, /invoice\s*(?:number|#)?\s*:?\s*(\w+)/i),
            totalAmount: this.extractMonetaryValue(text, /total\s*(?:amount|cost)?\s*:?\s*₹?([\d,]+\.?\d*)/i),
            clicks: this.extractNumericValue(text, /clicks?\s*:?\s*([\d,]+)/i),
            impressions: this.extractNumericValue(text, /impressions?\s*:?\s*([\d,]+)/i)
        };
    }

    extractCampaigns(text) {
        const campaigns = [];
        const regex = /(.*?)\s+(\d+)\s+Clicks\s+₹?([\d,]+\.\d{2})/gi;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const campaignName = match[1].trim();
            const clicks = parseInt(match[2]);
            const amount = parseFloat(match[3].replace(/,/g, ""));
            campaigns.push({
                campaignName,
                clicks,
                amount,
                cpc: clicks > 0 ? parseFloat((amount / clicks).toFixed(2)) : null
            });
        }
        return campaigns;
    }

    extractPattern(text, regex, group = 1) {
        const match = text.match(regex);
        return match ? match[group].trim() : null;
    }

    extractMonetaryValue(text, regex, group = 1) {
        const match = text.match(regex);
        if (match) {
            const value = parseFloat(match[group].replace(/,/g, ""));
            return !isNaN(value) ? value : null;
        }
        return null;
    }

    extractNumericValue(text, regex) {
        const match = text.match(regex);
        if (match) {
            const value = parseInt(match[1].replace(/,/g, ""));
            return !isNaN(value) ? value : null;
        }
        return null;
    }

    toNumber(val) {
        const num = parseFloat(val);
        return !isNaN(num) ? num : null;
    }
}

module.exports = PdfProcessor;
