
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

module.exports = router;