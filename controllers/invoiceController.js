const Invoice = require('../models/Invoice');
const { validationResult } = require('express-validator');
const path = require('path');

class InvoiceController {
    static async getAllInvoices(req, res) {
        try {
            const {
                platform,
                startDate,
                endDate,
                campaignName,
                page = 1,
                limit = 20,
                sortBy = 'processedAt',
                sortOrder = 'desc'
            } = req.query;

            // Build filter object
            const filter = {};

            if (platform && platform !== 'all') {
                filter.platform = platform;
            }

            if (startDate || endDate) {
                filter['extractedData.invoiceDate'] = {};
                if (startDate) filter['extractedData.invoiceDate'].$gte = new Date(startDate);
                if (endDate) filter['extractedData.invoiceDate'].$lte = new Date(endDate);
            }

            if (campaignName) {
                filter['extractedData.campaignName'] = {
                    $regex: campaignName,
                    $options: 'i'
                };
            }

            // Calculate pagination
            const skip = (page - 1) * limit;
            const sortObj = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

            // Count docs for pagination
            const total = await Invoice.countDocuments(filter);

            // Stream response
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Transfer-Encoding': 'chunked'
            });

            // Start JSON structure
            res.write('{');
            res.write(`"pagination":${JSON.stringify({
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalInvoices: total,
                hasNext: skip + parseInt(limit) < total,
                hasPrev: page > 1
            })},`);
            res.write('"invoices":[');

            let first = true;

            const cursor = Invoice.find(filter)
                .sort(sortObj)
                .skip(skip)
                .limit(parseInt(limit))
                .select('-rawText')
                .cursor();

            cursor.on('data', (doc) => {
                if (!first) res.write(',');
                first = false;

                const inv = doc.toObject();
                inv.pdfUrl = inv.filePath
                    ? `${req.protocol}://${req.get('host')}/uploads/${path.basename(inv.filePath)}`
                    : null;

                res.write(JSON.stringify(inv));
            });

            cursor.on('end', () => {
                res.write(']}');
                res.end();
            });

            cursor.on('error', (err) => {
                res.status(500).json({ error: err.message });
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    static async getInvoiceById(req, res) {
        try {
            const { id } = req.params;
            const invoice = await Invoice.findById(id);

            if (!invoice) {
                return res.status(404).json({ error: 'Invoice not found' });
            }

            res.json({
                invoice: {
                    ...invoice.toObject(),
                    pdfUrl: invoice.filePath ? `${req.protocol}://${req.get('host')}/uploads/${path.basename(invoice.filePath)}` : null
                }
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    static async getInvoicesByPlatform(req, res) {
        try {
            const { platform } = req.params;
            const { page = 1, limit = 20 } = req.query;

            const validPlatforms = ['google_ads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'other'];
            if (!validPlatforms.includes(platform)) {
                return res.status(400).json({ error: 'Invalid platform' });
            }

            const skip = (page - 1) * limit;
            const total = await Invoice.countDocuments({ platform });

            // Stream response
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Transfer-Encoding': 'chunked'
            });

            res.write('{');
            res.write(`"pagination":${JSON.stringify({
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalInvoices: total
            })},`);
            res.write(`"platform":"${platform}",`);
            res.write('"invoices":[');

            let first = true;

            const cursor = Invoice.find({ platform })
                .sort({ processedAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .select('-rawText')
                .cursor();

            cursor.on('data', (doc) => {
                if (!first) res.write(',');
                first = false;
                
                const inv = doc.toObject();
                inv.pdfUrl = inv.filePath
                    ? `${req.protocol}://${req.get('host')}/uploads/${path.basename(inv.filePath)}`
                    : null;
                
                res.write(JSON.stringify(inv));
            });

            cursor.on('end', () => {
                res.write(']}');
                res.end();
            });

            cursor.on('error', (err) => {
                res.status(500).json({ error: err.message });
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    static async getAnalytics(req, res) {
        try {
            const { platform, startDate, endDate } = req.query;

            const matchStage = {};
            if (platform && platform !== 'all') matchStage.platform = platform;
            if (startDate || endDate) {
                matchStage['extractedData.invoiceDate'] = {};
                if (startDate) matchStage['extractedData.invoiceDate'].$gte = new Date(startDate);
                if (endDate) matchStage['extractedData.invoiceDate'].$lte = new Date(endDate);
            }

            const analytics = await Invoice.aggregate([
                { $match: matchStage },
                { $unwind: { path: "$extractedData.campaigns", preserveNullAndEmptyArrays: true } },
                {
                    $group: {
                        _id: "$platform",
                        totalInvoices: { $sum: 1 },
                        totalAmount: { $sum: "$extractedData.totalAmount" },
                        subtotal: { $sum: "$extractedData.subtotal" },

                        totalClicks: { $sum: "$extractedData.campaigns.clicks" },
                        avgCPC: { $avg: "$extractedData.campaigns.cpc" },

                        totalImpressions: { $sum: "$extractedData.campaigns.impressions" },
                        avgCPM: {
                            $avg: {
                                $cond: [
                                    { $gt: ["$extractedData.campaigns.impressions", 0] },
                                    {
                                        $multiply: [
                                            { $divide: ["$extractedData.campaigns.amount", "$extractedData.campaigns.impressions"] },
                                            1000
                                        ]
                                    },
                                    null
                                ]
                            }
                        }
                    }
                },
                { $sort: { totalAmount: -1 } }
            ]);

            res.json({ analytics });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    static async deleteInvoice(req, res) {
        try {
            const { id } = req.params;
            const invoice = await Invoice.findByIdAndDelete(id);

            if (!invoice) {
                return res.status(404).json({ error: 'Invoice not found' });
            }

            res.json({ message: 'Invoice deleted successfully' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = InvoiceController;
