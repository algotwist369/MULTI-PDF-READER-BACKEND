
const express = require('express');
const { query } = require('express-validator');
const InvoiceController = require('../controllers/invoiceController');

const router = express.Router();

// Get analytics 
router.get('/', InvoiceController.getAllInvoices);


// Get all invoices with filtering
router.get('/analytics/summary', [
    query('platform').optional().isIn(['google_ads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'other', 'all']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601()
], InvoiceController.getAnalytics);


// Get analytics 
router.get('/analytics/summary', InvoiceController.getAnalytics);

// Get invoices by platform (must come before /:id route)
router.get('/platform/:platform', InvoiceController.getInvoicesByPlatform);

// Bulk delete invoices by time period
router.delete('/bulk-delete', InvoiceController.bulkDeleteInvoices);

// Preview bulk delete (get count without deleting)
router.post('/bulk-delete/preview', InvoiceController.previewBulkDelete);

// Get invoice by ID
router.get('/:id', InvoiceController.getInvoiceById);

// Delete invoice
router.delete('/:id', InvoiceController.deleteInvoice);

module.exports = router;