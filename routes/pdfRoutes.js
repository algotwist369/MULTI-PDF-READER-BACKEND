
const express = require('express');
const PdfController = require('../controllers/pdfController');

const router = express.Router();

// Upload PDFs
router.post('/upload', PdfController.uploadMiddleware, PdfController.uploadPdfs);

// Get processing status
router.get('/status/:fileName', PdfController.getProcessingStatus);

// Download PDF
router.get('/download/:fileName', PdfController.downloadPdf);

// Get PDF info
router.get('/info/:fileName', PdfController.getPdfInfo);

// Bulk download PDFs by platform
router.get('/bulk-download/:platform', PdfController.bulkDownloadPdfs);

// Get PDFs by platform for bulk operations
router.get('/platform/:platform', PdfController.getPdfsByPlatform);

// View PDF (serves PDF directly)
router.get('/view/:fileName', PdfController.viewPdf);

// Delete PDF file
router.delete('/delete/:fileName', PdfController.deletePdf);

// Bulk delete PDFs
router.delete('/bulk-delete', PdfController.bulkDeletePdfs);

// Cancel ongoing upload
router.post('/cancel-upload/:uploadId', PdfController.cancelUpload);

// Pause ongoing upload
router.post('/pause-upload/:uploadId', PdfController.pauseUpload);

// Resume paused upload
router.post('/resume-upload/:uploadId', PdfController.resumeUpload);

// Debug endpoint for file path issues
router.get('/debug/:fileName', PdfController.debugFilePath);

module.exports = router;