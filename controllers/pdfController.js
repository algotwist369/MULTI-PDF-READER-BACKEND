

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const unzipper = require('unzipper');
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
        fileSize: 500 * 1024 * 1024, // 500MB per file (increased for ZIP files)
        files: 200 // Maximum 200 files
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
        const allowedExtensions = ['.pdf', '.zip'];
        const fileExtension = path.extname(file.originalname).toLowerCase();
        
        // Accept if it's a known MIME type or has the right extension
        if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
            cb(null, true);
        } else {
            cb(new Error(`Only PDF and ZIP files are allowed. Received: ${file.mimetype} (${fileExtension})`));
        }
    }
});

class PdfController {
    static uploadMiddleware = upload.array('pdfs', 200);

    // Helper function to resolve file path correctly in production
    static resolveFilePath(filePath) {
        if (!filePath) return null;
        
        // If it's already an absolute path, check if it exists
        if (path.isAbsolute(filePath)) {
            if (fs.existsSync(filePath)) {
                return filePath;
            }
        }
        
        // Try to resolve relative to uploads directory
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        const fileName = path.basename(filePath);
        const resolvedPath = path.join(uploadsDir, fileName);
        
        if (fs.existsSync(resolvedPath)) {
            return resolvedPath;
        }
        
        // If still not found, try to find by filename in uploads directory
        try {
            const files = fs.readdirSync(uploadsDir);
            const matchingFile = files.find(file => file.includes(fileName.replace(/\.[^/.]+$/, "")));
            if (matchingFile) {
                return path.join(uploadsDir, matchingFile);
            }
        } catch (error) {
            console.error('Error searching for file:', error);
        }
        
        // If the filePath contains a production server path, try to extract just the filename
        // and look for it in the local uploads directory
        if (filePath.includes('/var/www/') || filePath.includes('MULTI-PDF-READER-BACKEND')) {
            const extractedFileName = path.basename(filePath);
            const localPath = path.join(uploadsDir, extractedFileName);
            
            if (fs.existsSync(localPath)) {
                return localPath;
            }
            
            // Try to find a file that contains the extracted filename (without extension)
            try {
                const files = fs.readdirSync(uploadsDir);
                const baseNameWithoutExt = extractedFileName.replace(/\.[^/.]+$/, "");
                const matchingFile = files.find(file => {
                    const fileBaseName = file.replace(/\.[^/.]+$/, "");
                    return fileBaseName.includes(baseNameWithoutExt) || baseNameWithoutExt.includes(fileBaseName);
                });
                
                if (matchingFile) {
                    return path.join(uploadsDir, matchingFile);
                }
            } catch (error) {
                console.error('Error searching for file with extracted name:', error);
            }
        }
        
        return null;
    }

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

            // Check by file hash first (most accurate)
            const existingByHash = await Invoice.findOne({ fileHash });
            if (existingByHash) {
                return {
                    isDuplicate: true,
                    reason: `File content already exists (${existingByHash.fileName})`,
                    existingFile: existingByHash,
                    duplicateType: 'content'
                };
            }

            // Check by exact filename match (case-sensitive)
            const existingByExactName = await Invoice.findOne({ fileName: originalName });
            if (existingByExactName) {
                return {
                    isDuplicate: true,
                    reason: `File with exact same name already exists`,
                    existingFile: existingByExactName,
                    duplicateType: 'filename'
                };
            }

            // Check by filename without extension
            const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
            const existingByNameWithoutExt = await Invoice.findOne({
                fileName: { $regex: new RegExp(`^${nameWithoutExt}\\.[^/.]+$`, 'i') }
            });
            if (existingByNameWithoutExt) {
                return {
                    isDuplicate: true,
                    reason: `File with similar name already exists (${existingByNameWithoutExt.fileName})`,
                    existingFile: existingByNameWithoutExt,
                    duplicateType: 'similar_name'
                };
            }

            // Check by case-insensitive filename
            const existingByName = await Invoice.findOne({
                fileName: { $regex: new RegExp(`^${originalName}$`, 'i') }
            });
            if (existingByName) {
                return {
                    isDuplicate: true,
                    reason: `File with same name (case-insensitive) already exists`,
                    existingFile: existingByName,
                    duplicateType: 'case_insensitive'
                };
            }

            return { isDuplicate: false };
        } catch (error) {
            console.error('Error checking for duplicates:', error);
            return { isDuplicate: false, error: error.message };
        }
    }

    // Helper function to extract PDFs from ZIP file
    static async extractPdfsFromZip(zipFilePath) {
        const extractedFiles = [];
        const uploadDir = path.dirname(zipFilePath);
        
        try {
            const directory = await unzipper.Open.file(zipFilePath);
            
            for (const file of directory.files) {
                if (file.type === 'File' && path.extname(file.path).toLowerCase() === '.pdf') {
                    const fileName = path.basename(file.path);
                    const extractedPath = path.join(uploadDir, `${Math.floor(Math.random() * 10000)}-${fileName}`);
                    
                    await new Promise((resolve, reject) => {
                        file.stream()
                            .pipe(fs.createWriteStream(extractedPath))
                            .on('close', resolve)
                            .on('error', reject);
                    });
                    
                    extractedFiles.push({
                        path: extractedPath,
                        originalName: fileName,
                        size: file.vars?.uncompressedSize || file.uncompressedSize || 0
                    });
                }
            }
            
            // Delete the original ZIP file
            fs.unlinkSync(zipFilePath);
            
            return extractedFiles;
        } catch (error) {
            console.error('Error extracting ZIP file:', error);
            throw error;
        }
    }

    static async uploadPdfs(req, res) {
        try {
            const files = req.files;
            if (!files || files.length === 0) {
                return res.status(400).json({ error: 'No files uploaded' });
            }

            const results = [];
            const processor = new PdfProcessor();
            const batchSize = 15; // Increased for even faster processing
            const duplicates = [];
            const processedFiles = [];
            let allFiles = [];
            let totalFiles = 0;
            let processedCount = 0;
            let isUploadCancelled = false;
            let isUploadPaused = false;

            // Get WebSocket instance
            const io = req.app.get('io');
            const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Store upload state globally for pause/resume functionality
            global.uploadStates = global.uploadStates || {};
            global.uploadStates[uploadId] = {
                isPaused: false,
                isCancelled: false,
                processedCount: 0,
                totalFiles: 0
            };

            // Send initial upload start notification
            if (io) {
                io.emit('upload:start', {
                    uploadId,
                    totalFiles: files.length,
                    message: 'Starting file processing...'
                });
            }

            // Process ZIP files first to extract PDFs
            for (const file of files) {
                if (global.uploadStates[uploadId]?.isCancelled) break;

                const fileExtension = path.extname(file.originalname).toLowerCase();
                const isZipFile = fileExtension === '.zip' || 
                                file.mimetype === 'application/zip' || 
                                file.mimetype === 'application/x-zip-compressed' ||
                                file.mimetype === 'application/x-zip' ||
                                (file.mimetype === 'application/octet-stream' && fileExtension === '.zip');
                
                if (isZipFile) {
                    try {
                        // Send ZIP processing notification
                        if (io) {
                            io.emit('upload:progress', {
                                uploadId,
                                fileName: file.originalname,
                                status: 'processing_zip',
                                message: `Extracting PDFs from ${file.originalname}...`
                            });
                        }

                        const extractedPdfs = await PdfController.extractPdfsFromZip(file.path);
                        allFiles.push(...extractedPdfs.map(pdf => ({
                            path: pdf.path,
                            originalname: pdf.originalName,
                            size: pdf.size,
                            mimetype: 'application/pdf',
                            isTemporary: true // Mark as temporary until successful processing
                        })));

                        // Send ZIP processing completion
                        if (io) {
                            io.emit('upload:progress', {
                                uploadId,
                                fileName: file.originalname,
                                status: 'zip_extracted',
                                message: `Extracted ${extractedPdfs.length} PDFs from ${file.originalname}`,
                                extractedCount: extractedPdfs.length
                            });
                        }

                        // Clean up the original ZIP file
                        if (fs.existsSync(file.path)) {
                            fs.unlinkSync(file.path);
                        }
                    } catch (error) {
                        console.error('Error processing ZIP file:', error);
                        
                        // Clean up the ZIP file if extraction failed
                        if (fs.existsSync(file.path)) {
                            try {
                                fs.unlinkSync(file.path);
                                console.log(`Cleaned up failed ZIP file: ${file.path}`);
                            } catch (cleanupError) {
                                console.error(`Error cleaning up ZIP file ${file.path}:`, cleanupError);
                            }
                        }
                        
                        results.push({
                            fileName: file.originalname,
                            status: 'error',
                            error: `Failed to extract ZIP file: ${error.message}`
                        });

                        // Send ZIP processing error
                        if (io) {
                            io.emit('upload:progress', {
                                uploadId,
                                fileName: file.originalname,
                                status: 'error',
                                message: `Failed to extract ZIP: ${error.message}`
                            });
                        }
                    }
                } else {
                    allFiles.push({
                        ...file,
                        isTemporary: true // Mark as temporary until successful processing
                    });
                }
            }

            totalFiles = allFiles.length;
            global.uploadStates[uploadId].totalFiles = totalFiles;

            if (allFiles.length === 0) {
                return res.status(400).json({ error: 'No PDF files found in uploaded files' });
            }

            // Send total files count
            if (io) {
                io.emit('upload:progress', {
                    uploadId,
                    status: 'total_count',
                    totalFiles,
                    message: `Found ${totalFiles} PDF files to process`
                });
            }

            for (let i = 0; i < allFiles.length && !global.uploadStates[uploadId]?.isCancelled; i += batchSize) {
                // Check for pause state
                while (global.uploadStates[uploadId]?.isPaused && !global.uploadStates[uploadId]?.isCancelled) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                if (global.uploadStates[uploadId]?.isCancelled) break;

                const batch = allFiles.slice(i, i + batchSize);

                const batchPromises = batch.map(async (file) => {
                    try {
                        // Check for pause/cancel before processing each file
                        if (global.uploadStates[uploadId]?.isCancelled) {
                            throw new Error('Upload cancelled');
                        }

                        while (global.uploadStates[uploadId]?.isPaused && !global.uploadStates[uploadId]?.isCancelled) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }

                        if (global.uploadStates[uploadId]?.isCancelled) {
                            throw new Error('Upload cancelled');
                        }

                        // Send file processing start notification
                        if (io) {
                            io.emit('upload:progress', {
                                uploadId,
                                fileName: file.originalname,
                                status: 'processing',
                                message: `Processing ${file.originalname}...`,
                                progress: Math.round((processedCount / totalFiles) * 100)
                            });
                        }

                        // Check for duplicates
                        const duplicateCheck = await PdfController.checkForDuplicates(file.path, file.originalname);

                        if (duplicateCheck.isDuplicate) {
                            // Clean up temporary file
                            if (fs.existsSync(file.path)) {
                                fs.unlinkSync(file.path);
                            }
                            
                            processedCount++;
                            global.uploadStates[uploadId].processedCount = processedCount;
                            
                            // Send duplicate detection notification
                            if (io) {
                                io.emit('upload:progress', {
                                    uploadId,
                                    fileName: file.originalname,
                                    status: 'duplicate',
                                    message: `Duplicate detected: ${duplicateCheck.reason}`,
                                    reason: duplicateCheck.reason,
                                    progress: Math.round((processedCount / totalFiles) * 100)
                                });
                            }

                            return {
                                fileName: file.originalname,
                                status: 'duplicate',
                                reason: duplicateCheck.reason,
                                existingFile: duplicateCheck.existingFile
                            };
                        }

                        // Process the PDF
                        const fileHash = await PdfController.calculateFileHash(file.path);
                        const result = await processor.processPdf(file);

                        // Only move file to uploads folder after successful processing
                        const uploadsDir = path.join(__dirname, '..', 'uploads');
                        const finalFileName = `${Math.floor(Math.random() * 10000)}-${file.originalname}`;
                        const finalPath = path.join(uploadsDir, finalFileName);

                        // Ensure uploads directory exists
                        if (!fs.existsSync(uploadsDir)) {
                            fs.mkdirSync(uploadsDir, { recursive: true });
                        }

                        // Move file from temporary location to uploads folder
                        fs.renameSync(file.path, finalPath);

                        await Invoice.updateOne(
                            { fileName: file.originalname },
                            {
                                $set: {
                                    filePath: finalPath,
                                    fileHash: fileHash
                                }
                            }
                        );

                        processedFiles.push({
                            fileName: file.originalname,
                            filePath: finalPath,
                            fileHash: fileHash
                        });

                        processedCount++;
                        global.uploadStates[uploadId].processedCount = processedCount;

                        // Send successful processing notification
                        if (io) {
                            io.emit('upload:progress', {
                                uploadId,
                                fileName: file.originalname,
                                status: 'completed',
                                message: `Successfully processed ${file.originalname}`,
                                progress: Math.round((processedCount / totalFiles) * 100),
                                result: {
                                    ...result,
                                    pdfUrl: `${req.protocol}://${req.get('host')}/uploads/${finalFileName}`
                                }
                            });
                        }

                        return {
                            ...result,
                            pdfUrl: `${req.protocol}://${req.get('host')}/uploads/${finalFileName}`
                        };
                    } catch (error) {
                        // Clean up the temporary file if it exists
                        if (fs.existsSync(file.path)) {
                            try {
                                fs.unlinkSync(file.path);
                                console.log(`Cleaned up failed file: ${file.path}`);
                            } catch (cleanupError) {
                                console.error(`Error cleaning up file ${file.path}:`, cleanupError);
                            }
                        }
                        
                        processedCount++;
                        global.uploadStates[uploadId].processedCount = processedCount;

                        // Send error notification
                        if (io) {
                            io.emit('upload:progress', {
                                uploadId,
                                fileName: file.originalname,
                                status: 'error',
                                message: `Failed to process ${file.originalname}: ${error.message}`,
                                error: error.message,
                                progress: Math.round((processedCount / totalFiles) * 100)
                            });
                        }

                        throw error;
                    }
                });

                const batchResults = await Promise.allSettled(batchPromises);

                // Process batch results
                batchResults.forEach(r => {
                    if (r.status === "fulfilled") {
                        if (r.value.status === 'duplicate') {
                            duplicates.push(r.value);
                        } else if (r.value?.extractedData) {
                            let data = r.value.extractedData;

                            // Post-process extracted data
                            if (!data.subtotal && data.totalAmount && data.taxAmount) {
                                data.subtotal = parseFloat((data.totalAmount - data.taxAmount).toFixed(2));
                            }

                            if (!data.totalAmount && data.subtotal && data.taxAmount) {
                                data.totalAmount = parseFloat((data.subtotal + data.taxAmount).toFixed(2));
                            }

                            if ((!data.subtotal || data.subtotal === 0) && Array.isArray(data.campaigns) && data.campaigns.length > 0) {
                                data.subtotal = data.campaigns.reduce((sum, c) => sum + (c.amount || 0), 0);
                            }

                            r.value.extractedData = data;
                        }
                    }
                });

                results.push(...batchResults);

                // Add minimal delay between batches to prevent overwhelming the system
                if (i + batchSize < allFiles.length && !global.uploadStates[uploadId]?.isCancelled) {
                    await new Promise(resolve => setTimeout(resolve, 100)); // Further reduced delay
                }
            }

            const successful = results.filter(r => r.status === 'fulfilled' && r.value.status !== 'duplicate').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            const duplicateCount = duplicates.length;

            // Clean up upload state
            delete global.uploadStates[uploadId];

            // Send final completion notification
            if (io) {
                io.emit('upload:complete', {
                    uploadId,
                    successful,
                    failed,
                    duplicates: duplicateCount,
                    totalFiles,
                    message: `Upload completed: ${successful} successful, ${failed} failed, ${duplicateCount} duplicates`
                });
            }

            res.json({
                uploadId,
                message: `Processed ${totalFiles} files`,
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
            
            // Clean up upload state on error
            if (global.uploadStates && global.uploadStates[uploadId]) {
                delete global.uploadStates[uploadId];
            }
            
            // Send error notification
            const io = req.app.get('io');
            if (io) {
                io.emit('upload:error', {
                    message: `Upload failed: ${error.message}`,
                    error: error.message
                });
            }
            
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
            const resolvedFilePath = PdfController.resolveFilePath(filePath);

            if (!resolvedFilePath) {
                return res.status(404).json({ error: 'PDF file not found on server' });
            }

            // Download the file using the actual filePath from database
            res.download(resolvedFilePath, invoice.fileName);
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
            const resolvedFilePath = PdfController.resolveFilePath(filePath);
            let fileStats = null;

            if (resolvedFilePath && fs.existsSync(resolvedFilePath)) {
                fileStats = fs.statSync(resolvedFilePath);
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
            
            console.log(`View PDF request for fileName: ${fileName}`);
            
            // Find the invoice by fileName (this is the original filename without prefix)
            const invoice = await Invoice.findOne({ fileName });
            
            if (!invoice) {
                console.log(`Invoice not found for fileName: ${fileName}`);
                return res.status(404).json({ error: 'Invoice not found' });
            }
            
            if (!invoice.filePath) {
                console.log(`No filePath found for invoice: ${invoice._id}`);
                return res.status(404).json({ error: 'PDF file path not found' });
            }

            const filePath = invoice.filePath;
            
            // Check if this is a Meta Ads invoice that was processed on a different server
            if (invoice.platform === 'meta_ads' && (filePath.includes('/var/www/') || filePath.includes('MULTI-PDF-READER-BACKEND'))) {
                console.log(`Meta Ads invoice with production server path detected: ${filePath}`);
                return res.status(404).json({ 
                    error: 'PDF file not available locally',
                    message: 'This Meta Ads invoice was processed on a different server and the PDF file is not available in the local environment. Please contact the administrator to sync the files.',
                    platform: invoice.platform,
                    fileName: invoice.fileName
                });
            }

            const resolvedFilePath = PdfController.resolveFilePath(filePath);

            console.log(`Original filePath: ${filePath}`);
            console.log(`Resolved filePath: ${resolvedFilePath}`);

            if (!resolvedFilePath) {
                console.log(`Could not resolve file path for: ${filePath}`);
                return res.status(404).json({ error: 'PDF file not found on server' });
            }

            if (!fs.existsSync(resolvedFilePath)) {
                console.log(`File does not exist at path: ${resolvedFilePath}`);
                return res.status(404).json({ error: 'PDF file does not exist on server' });
            }

            // Get file stats
            const stats = fs.statSync(resolvedFilePath);
            const fileSize = stats.size;
            const range = req.headers.range;

            console.log(`Serving PDF: ${resolvedFilePath}, size: ${fileSize} bytes`);

            if (range) {
                // Handle range requests for streaming
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = (end - start) + 1;
                const file = fs.createReadStream(resolvedFilePath, { start, end });
                
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
                const fileStream = fs.createReadStream(resolvedFilePath);
                fileStream.on('error', (error) => {
                    console.error('Error streaming PDF file:', error);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Error streaming PDF file' });
                    }
                });
                fileStream.pipe(res);
            }
        } catch (error) {
            console.error('Error viewing PDF:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
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
            const existingFiles = invoices.filter(inv => inv.filePath && PdfController.resolveFilePath(inv.filePath));

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
                        const resolvedFilePath = PdfController.resolveFilePath(filePath);
                        
                        if (resolvedFilePath && fs.existsSync(resolvedFilePath)) {
                            archive.file(resolvedFilePath, { name: fileName });
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

    // New endpoint to delete PDF file
    static async deletePdf(req, res) {
        try {
            const { fileName } = req.params;
            
            // Find the invoice by fileName
            const invoice = await Invoice.findOne({ fileName });
            
            if (!invoice) {
                return res.status(404).json({ error: 'PDF file not found' });
            }

            const filePath = invoice.filePath;

            // Delete file from filesystem if it exists
            if (filePath && fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    console.log(`Deleted file from filesystem: ${filePath}`);
                } catch (fsError) {
                    console.error('Error deleting file from filesystem:', fsError);
                    // Continue with database deletion even if file deletion fails
                }
            }

            // Delete from database
            await Invoice.deleteOne({ fileName });

            res.json({
                message: `Successfully deleted ${fileName}`,
                deletedFile: fileName
            });
        } catch (error) {
            console.error('Delete PDF error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // New endpoint to bulk delete PDFs
    static async bulkDeletePdfs(req, res) {
        try {
            const { fileNames } = req.body;
            
            if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
                return res.status(400).json({ error: 'No file names provided' });
            }

            const results = [];
            const deletedFiles = [];
            const failedFiles = [];

            for (const fileName of fileNames) {
                try {
                    // Find the invoice
                    const invoice = await Invoice.findOne({ fileName });
                    
                    if (!invoice) {
                        failedFiles.push({ fileName, reason: 'File not found in database' });
                        continue;
                    }

                    const filePath = invoice.filePath;

                    // Delete file from filesystem if it exists
                    if (filePath && fs.existsSync(filePath)) {
                        try {
                            fs.unlinkSync(filePath);
                            console.log(`Deleted file from filesystem: ${filePath}`);
                        } catch (fsError) {
                            console.error(`Error deleting file from filesystem: ${filePath}`, fsError);
                            // Continue with database deletion
                        }
                    }

                    // Delete from database
                    await Invoice.deleteOne({ fileName });
                    
                    deletedFiles.push(fileName);
                    results.push({ fileName, status: 'deleted' });

                } catch (error) {
                    console.error(`Error deleting ${fileName}:`, error);
                    failedFiles.push({ fileName, reason: error.message });
                    results.push({ fileName, status: 'failed', error: error.message });
                }
            }

            res.json({
                message: `Bulk delete completed`,
                totalFiles: fileNames.length,
                deletedFiles: deletedFiles.length,
                failedFiles: failedFiles.length,
                results: results
            });

        } catch (error) {
            console.error('Bulk delete error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // Debug endpoint to help troubleshoot file path issues
    static async debugFilePath(req, res) {
        try {
            const { fileName } = req.params;
            
            // Find the invoice by fileName
            const invoice = await Invoice.findOne({ fileName });
            
            if (!invoice) {
                return res.status(404).json({ error: 'Invoice not found' });
            }

            const filePath = invoice.filePath;
            const resolvedFilePath = PdfController.resolveFilePath(filePath);
            const uploadsDir = path.join(__dirname, '..', 'uploads');
            
            // Get list of files in uploads directory
            let uploadsFiles = [];
            try {
                uploadsFiles = fs.readdirSync(uploadsDir);
            } catch (error) {
                console.error('Error reading uploads directory:', error);
            }

            res.json({
                fileName: invoice.fileName,
                originalFilePath: filePath,
                resolvedFilePath: resolvedFilePath,
                fileExists: resolvedFilePath ? fs.existsSync(resolvedFilePath) : false,
                uploadsDirectory: uploadsDir,
                uploadsDirectoryExists: fs.existsSync(uploadsDir),
                filesInUploads: uploadsFiles,
                matchingFiles: uploadsFiles.filter(file => 
                    file.includes(fileName.replace(/\.[^/.]+$/, ""))
                )
            });
        } catch (error) {
            console.error('Debug file path error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // New endpoint to cancel ongoing upload
    static async cancelUpload(req, res) {
        try {
            const { uploadId } = req.params;
            
            // Get WebSocket instance
            const io = req.app.get('io');
            
            if (global.uploadStates && global.uploadStates[uploadId]) {
                global.uploadStates[uploadId].isCancelled = true;
                
                if (io) {
                    io.emit('upload:cancelled', {
                        uploadId,
                        message: 'Upload cancelled by user'
                    });
                }
            }

            res.json({
                message: 'Upload cancellation requested',
                uploadId
            });
        } catch (error) {
            console.error('Cancel upload error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // New endpoint to pause ongoing upload
    static async pauseUpload(req, res) {
        try {
            const { uploadId } = req.params;
            
            // Get WebSocket instance
            const io = req.app.get('io');
            
            if (global.uploadStates && global.uploadStates[uploadId]) {
                global.uploadStates[uploadId].isPaused = true;
                
                if (io) {
                    io.emit('upload:paused', {
                        uploadId,
                        message: 'Upload paused by user'
                    });
                }
            }

            res.json({
                message: 'Upload pause requested',
                uploadId
            });
        } catch (error) {
            console.error('Pause upload error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // New endpoint to resume paused upload
    static async resumeUpload(req, res) {
        try {
            const { uploadId } = req.params;
            
            // Get WebSocket instance
            const io = req.app.get('io');
            
            if (global.uploadStates && global.uploadStates[uploadId]) {
                global.uploadStates[uploadId].isPaused = false;
                
                if (io) {
                    io.emit('upload:resumed', {
                        uploadId,
                        message: 'Upload resumed by user'
                    });
                }
            }

            res.json({
                message: 'Upload resume requested',
                uploadId
            });
        } catch (error) {
            console.error('Resume upload error:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = PdfController;
