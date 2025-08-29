

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Invoice = require('../models/Invoice');
const PdfProcessor = require('../services/pdfProcessor');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Math.floor(Math.random() * 10000) + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 200 * 1024 * 1024, // 200MB per file
        files: 200 // Maximum 200 files
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    }
});

class PdfController {
    static uploadMiddleware = upload.array('pdfs', 200);

    // Helper function to calculate file hash
    static async calculateFileHash(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('md5');
            const stream = fs.createReadStream(filePath);

            stream.on('data', (data) => {
                hash.update(data);
            });

            stream.on('end', () => {
                resolve(hash.digest('hex'));
            });

            stream.on('error', (error) => {
                reject(error);
            });
        });
    }

    // Helper function to check for duplicates
    static async checkForDuplicates(filePath, originalName) {
        try {
            const fileHash = await this.calculateFileHash(filePath);

            // Check by file hash
            const existingByHash = await Invoice.findOne({ fileHash });
            if (existingByHash) {
                return {
                    isDuplicate: true,
                    reason: 'File content already exists',
                    existingFile: existingByHash
                };
            }

            // Check by original filename (case-insensitive)
            const existingByName = await Invoice.findOne({
                fileName: { $regex: new RegExp(`^${originalName}$`, 'i') }
            });

            if (existingByName) {
                return {
                    isDuplicate: true,
                    reason: 'File with same name already exists',
                    existingFile: existingByName
                };
            }

            return { isDuplicate: false };
        } catch (error) {
            console.error('Error checking for duplicates:', error);
            return { isDuplicate: false, error: error.message };
        }
    }

    static async uploadPdfs(req, res) {
        try {
            const files = req.files;
            if (!files || files.length === 0) {
                return res.status(400).json({ error: 'No PDF files uploaded' });
            }

            const results = [];
            const processor = new PdfProcessor();
            const batchSize = 5;
            const duplicates = [];
            const processedFiles = [];

            for (let i = 0; i < files.length; i += batchSize) {
                const batch = files.slice(i, i + batchSize);

                const batchPromises = batch.map(async (file) => {
                    try {
                        // Call directly on PdfController, not `this`
                        const duplicateCheck = await PdfController.checkForDuplicates(file.path, file.originalname);

                        if (duplicateCheck.isDuplicate) {
                            fs.unlinkSync(file.path);
                            return {
                                fileName: file.originalname,
                                status: 'duplicate',
                                reason: duplicateCheck.reason,
                                existingFile: duplicateCheck.existingFile
                            };
                        }

                        // Same here
                        const fileHash = await PdfController.calculateFileHash(file.path);

                        const result = await processor.processPdf(file);

                        await Invoice.updateOne(
                            { fileName: file.originalname },
                            {
                                $set: {
                                    filePath: file.path,
                                    fileHash: fileHash
                                }
                            }
                        );

                        processedFiles.push({
                            fileName: file.originalname,
                            filePath: file.path,
                            fileHash: fileHash
                        });

                        return {
                            ...result,
                            pdfUrl: `${req.protocol}://${req.get('host')}/uploads/${path.basename(file.path)}`
                        };
                    } catch (error) {
                        if (fs.existsSync(file.path)) {
                            fs.unlinkSync(file.path);
                        }
                        throw error;
                    }
                });


                const batchResults = await Promise.allSettled(batchPromises);

                // 🔹 Post-process each extractedData
                batchResults.forEach(r => {
                    if (r.status === "fulfilled") {
                        if (r.value.status === 'duplicate') {
                            duplicates.push(r.value);
                        } else if (r.value?.extractedData) {
                            let data = r.value.extractedData;

                            //   If subtotal missing, calculate from total - tax
                            if (!data.subtotal && data.totalAmount && data.taxAmount) {
                                data.subtotal = parseFloat((data.totalAmount - data.taxAmount).toFixed(2));
                            }

                            //   If totalAmount missing, calculate from subtotal + tax
                            if (!data.totalAmount && data.subtotal && data.taxAmount) {
                                data.totalAmount = parseFloat((data.subtotal + data.taxAmount).toFixed(2));
                            }

                            //   If campaigns exist but no subtotal, sum them
                            if ((!data.subtotal || data.subtotal === 0) && Array.isArray(data.campaigns) && data.campaigns.length > 0) {
                                data.subtotal = data.campaigns.reduce((sum, c) => sum + (c.amount || 0), 0);
                            }

                            r.value.extractedData = data;
                        }
                    }
                });

                results.push(...batchResults);

                if (i + batchSize < files.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            const successful = results.filter(r => r.status === 'fulfilled' && r.value.status !== 'duplicate').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            const duplicateCount = duplicates.length;

            res.json({
                message: `Processed ${files.length} files`,
                successful,
                failed,
                duplicates: duplicateCount,
                duplicateFiles: duplicates,
                results: results.map(r =>
                    r.status === 'fulfilled'
                        ? r.value
                        : { error: r.reason.message }
                )
            });

        } catch (error) {
            console.error('Error uploading PDFs:', error);
            res.status(500).json({ error: error.message });
        }
    }

    static async getProcessingStatus(req, res) {
        try {
            const { fileName } = req.params;
            const invoice = await Invoice.findOne({ fileName });

            if (!invoice) {
                return res.status(404).json({ error: 'Invoice not found' });
            }

            res.json({
                fileName: invoice.fileName,
                status: invoice.status,
                platform: invoice.platform,
                extractedData: invoice.extractedData,
                pdfUrl: invoice.filePath
                    ? `${req.protocol}://${req.get('host')}/uploads/${path.basename(invoice.filePath)}`
                    : null,
                errorMessage: invoice.errorMessage
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // New endpoint to download PDF
    static async downloadPdf(req, res) {
        try {
            const { fileName } = req.params;
            
            // Find the invoice by fileName (this is the original filename without prefix)
            const invoice = await Invoice.findOne({ fileName });
            
            if (!invoice || !invoice.filePath) {
                return res.status(404).json({ error: 'PDF file not found' });
            }

            const filePath = invoice.filePath;

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'PDF file not found on server' });
            }

            // Download the file using the actual filePath from database
            res.download(filePath, invoice.fileName);
        } catch (error) {
            console.error('Download PDF error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // New endpoint to get PDF info
    static async getPdfInfo(req, res) {
        try {
            const { fileName } = req.params;
            
            // Find the invoice by fileName (this is the original filename without prefix)
            const invoice = await Invoice.findOne({ fileName });
            
            if (!invoice) {
                return res.status(404).json({ error: 'Invoice not found' });
            }

            const filePath = invoice.filePath;
            let fileStats = null;

            if (filePath && fs.existsSync(filePath)) {
                fileStats = fs.statSync(filePath);
            }

            res.json({
                fileName: invoice.fileName,
                filePath: invoice.filePath,
                fileHash: invoice.fileHash,
                fileSize: fileStats ? fileStats.size : null,
                pdfUrl: invoice.filePath
                    ? `${req.protocol}://${req.get('host')}/uploads/${path.basename(invoice.filePath)}`
                    : null,
                status: invoice.status,
                platform: invoice.platform,
                processedAt: invoice.processedAt
            });
        } catch (error) {
            console.error('Get PDF info error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // New endpoint to view PDF directly
    static async viewPdf(req, res) {
        try {
            const { fileName } = req.params;
            
            // Find the invoice by fileName (this is the original filename without prefix)
            const invoice = await Invoice.findOne({ fileName });
            
            if (!invoice || !invoice.filePath) {
                return res.status(404).json({ error: 'PDF file not found' });
            }

            const filePath = invoice.filePath;

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'PDF file not found on server' });
            }

            // Get file stats
            const stats = fs.statSync(filePath);
            const fileSize = stats.size;
            const range = req.headers.range;

            if (range) {
                // Handle range requests for streaming
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = (end - start) + 1;
                const file = fs.createReadStream(filePath, { start, end });
                
                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `inline; filename="${invoice.fileName}"`,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                    'Access-Control-Allow-Headers': 'Range, Accept-Ranges, Content-Range'
                });
                
                file.pipe(res);
            } else {
                // Set appropriate headers for PDF viewing
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename="${invoice.fileName}"`);
                res.setHeader('Content-Length', fileSize);
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Range');

                // Stream the PDF file
                const fileStream = fs.createReadStream(filePath);
                fileStream.pipe(res);
            }
        } catch (error) {
            console.error('Error viewing PDF:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // New endpoint to get PDFs by platform
    static async getPdfsByPlatform(req, res) {
        try {
            const { platform } = req.params;
            const { page = 1, limit = 50 } = req.query;

            const validPlatforms = ['google_ads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'other'];
            if (!validPlatforms.includes(platform)) {
                return res.status(400).json({ error: 'Invalid platform' });
            }

            const skip = (page - 1) * limit;

            const [invoices, total] = await Promise.all([
                Invoice.find({ platform })
                    .sort({ processedAt: -1 })
                    .skip(skip)
                    .limit(parseInt(limit))
                    .select('fileName filePath platform extractedData'),
                Invoice.countDocuments({ platform })
            ]);

            res.json({
                platform,
                invoices: invoices.map(inv => ({
                    ...inv.toObject(),
                    pdfUrl: inv.filePath
                        ? `${req.protocol}://${req.get('host')}/uploads/${path.basename(inv.filePath)}`
                        : null
                })),
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalInvoices: total
                }
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // New endpoint for bulk download by platform
    static async bulkDownloadPdfs(req, res) {
        try {
            const { platform } = req.params;
            const { format = 'zip' } = req.query;

            const validPlatforms = ['google_ads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'other'];
            if (!validPlatforms.includes(platform)) {
                return res.status(400).json({ error: 'Invalid platform' });
            }

            // Get all PDFs for the platform
            const invoices = await Invoice.find({ platform })
                .select('fileName filePath')
                .sort({ processedAt: -1 });

            if (invoices.length === 0) {
                return res.status(404).json({ error: 'No PDFs found for this platform' });
            }

            // Check if all files exist
            const existingFiles = invoices.filter(inv => inv.filePath && fs.existsSync(inv.filePath));

            if (existingFiles.length === 0) {
                return res.status(404).json({ error: 'No PDF files found on server' });
            }

            if (format === 'zip') {
                // Create ZIP file for bulk download
                const archiver = require('archiver');
                const archive = archiver('zip', {
                    zlib: { level: 9 } // Sets the compression level
                });

                // Handle archive errors
                archive.on('error', (err) => {
                    console.error('Archive error:', err);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Failed to create ZIP file' });
                    }
                });

                // Handle archive warnings
                archive.on('warning', (err) => {
                    if (err.code === 'ENOENT') {
                        console.warn('Archive warning:', err);
                    } else {
                        throw err;
                    }
                });

                // Set response headers
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename="${platform}_invoices.zip"`);
                res.setHeader('Access-Control-Allow-Origin', '*');

                // Pipe archive data to the response
                archive.pipe(res);

                // Add each PDF to the archive
                existingFiles.forEach(invoice => {
                    try {
                        const fileName = invoice.fileName;
                        const filePath = invoice.filePath;
                        
                        if (fs.existsSync(filePath)) {
                            archive.file(filePath, { name: fileName });
                        } else {
                            console.warn(`File not found: ${filePath}`);
                        }
                    } catch (err) {
                        console.error(`Error adding file to archive: ${invoice.fileName}`, err);
                    }
                });

                // Finalize the archive
                await archive.finalize();
            } else {
                // Return list of PDF URLs for individual downloads
                res.json({
                    platform,
                    totalFiles: existingFiles.length,
                    files: existingFiles.map(inv => ({
                        fileName: inv.fileName,
                        downloadUrl: `${req.protocol}://${req.get('host')}/api/pdf/download/${encodeURIComponent(inv.fileName)}`,
                        viewUrl: `${req.protocol}://${req.get('host')}/api/pdf/view/${encodeURIComponent(inv.fileName)}`
                    }))
                });
            }
        } catch (error) {
            console.error('Bulk download error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        }
    }
}

module.exports = PdfController;
