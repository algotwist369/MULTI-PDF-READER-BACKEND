const Invoice = require('../models/Invoice');
const { validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs'); // Added for file deletion

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
            const invoice = await Invoice.findById(id);

            if (!invoice) {
                return res.status(404).json({ error: 'Invoice not found' });
            }

            // Delete the physical file if it exists
            if (invoice.filePath && fs.existsSync(invoice.filePath)) {
                fs.unlinkSync(invoice.filePath);
            }

            // Delete from database
            await Invoice.findByIdAndDelete(id);

            res.json({ message: 'Invoice deleted successfully' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    static async previewBulkDelete(req, res) {
        try {
            const { timePeriod, platform } = req.body;

            // Validate required fields
            if (!timePeriod) {
                return res.status(400).json({ 
                    error: 'timePeriod is required' 
                });
            }

            // Calculate date range based on time period
            const now = new Date();
            let startDate, endDate;

            switch (timePeriod) {
                case '1_day':
                    startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    endDate = now;
                    break;
                case '2_days':
                    startDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
                    endDate = now;
                    break;
                case '1_week':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    endDate = now;
                    break;
                case '2_weeks':
                    startDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
                    endDate = now;
                    break;
                case '1_month':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                    endDate = now;
                    break;
                case '3_months':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
                    endDate = now;
                    break;
                case '6_months':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
                    endDate = now;
                    break;
                case '1_year':
                    startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
                    endDate = now;
                    break;
                case 'all':
                    startDate = new Date(0); // Beginning of time
                    endDate = now;
                    break;
                default:
                    return res.status(400).json({ 
                        error: 'Invalid time period. Valid options: 1_day, 2_days, 1_week, 2_weeks, 1_month, 3_months, 6_months, 1_year, all' 
                    });
            }

            // Build filter
            const filter = {
                processedAt: {
                    $gte: startDate,
                    $lte: endDate
                }
            };

            // Add platform filter if specified
            if (platform && platform !== 'all') {
                const validPlatforms = ['google_ads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'other'];
                if (!validPlatforms.includes(platform)) {
                    return res.status(400).json({ error: 'Invalid platform' });
                }
                filter.platform = platform;
            }

            // Get count of invoices to be deleted
            const count = await Invoice.countDocuments(filter);

            // Get platform breakdown if no specific platform is selected
            let platformBreakdown = null;
            if (!platform || platform === 'all') {
                platformBreakdown = await Invoice.aggregate([
                    { $match: filter },
                    { $group: { _id: '$platform', count: { $sum: 1 } } },
                    { $sort: { count: -1 } }
                ]);
            }

            res.json({
                count,
                timePeriod,
                platform: platform || 'all',
                dateRange: {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                },
                platformBreakdown
            });

        } catch (error) {
            console.error('Preview bulk delete error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    static async bulkDeleteInvoices(req, res) {
        try {
            const { timePeriod, platform, confirm } = req.body;

            // Validate required fields
            if (!timePeriod || !confirm) {
                return res.status(400).json({ 
                    error: 'timePeriod and confirm are required' 
                });
            }

            if (confirm !== 'DELETE') {
                return res.status(400).json({ 
                    error: 'Confirmation must be "DELETE" to proceed' 
                });
            }

            // Calculate date range based on time period
            const now = new Date();
            let startDate, endDate;

            switch (timePeriod) {
                case '1_day':
                    startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    endDate = now;
                    break;
                case '2_days':
                    startDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
                    endDate = now;
                    break;
                case '1_week':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    endDate = now;
                    break;
                case '2_weeks':
                    startDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
                    endDate = now;
                    break;
                case '1_month':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                    endDate = now;
                    break;
                case '3_months':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
                    endDate = now;
                    break;
                case '6_months':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
                    endDate = now;
                    break;
                case '1_year':
                    startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
                    endDate = now;
                    break;
                case 'all':
                    startDate = new Date(0); // Beginning of time
                    endDate = now;
                    break;
                default:
                    return res.status(400).json({ 
                        error: 'Invalid time period. Valid options: 1_day, 2_days, 1_week, 2_weeks, 1_month, 3_months, 6_months, 1_year, all' 
                    });
            }

            // Build filter
            const filter = {
                processedAt: {
                    $gte: startDate,
                    $lte: endDate
                }
            };

            // Add platform filter if specified
            if (platform && platform !== 'all') {
                const validPlatforms = ['google_ads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'other'];
                if (!validPlatforms.includes(platform)) {
                    return res.status(400).json({ error: 'Invalid platform' });
                }
                filter.platform = platform;
            }

            // Get invoices to be deleted (for file cleanup)
            const invoicesToDelete = await Invoice.find(filter).select('filePath fileName');

            // Count total invoices to be deleted
            const totalToDelete = await Invoice.countDocuments(filter);

            if (totalToDelete === 0) {
                return res.json({ 
                    message: 'No invoices found for the specified criteria',
                    deletedCount: 0,
                    timePeriod,
                    platform: platform || 'all'
                });
            }

            // Delete physical files
            let deletedFiles = 0;
            let failedFiles = 0;

            for (const invoice of invoicesToDelete) {
                try {
                    if (invoice.filePath && fs.existsSync(invoice.filePath)) {
                        fs.unlinkSync(invoice.filePath);
                        deletedFiles++;
                    }
                } catch (error) {
                    console.error(`Failed to delete file: ${invoice.filePath}`, error);
                    failedFiles++;
                }
            }

            // Delete from database
            const deleteResult = await Invoice.deleteMany(filter);

            res.json({
                message: `Successfully deleted ${deleteResult.deletedCount} invoices`,
                deletedCount: deleteResult.deletedCount,
                deletedFiles,
                failedFiles,
                timePeriod,
                platform: platform || 'all',
                dateRange: {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                }
            });

        } catch (error) {
            console.error('Bulk delete error:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = InvoiceController;
