const mongoose = require('mongoose');
 
const campaignSchema = new mongoose.Schema({
    campaignName: { type: String },
    amount: { type: Number },        // spend without GST
    clicks: { type: Number },        // Google only
    cpc: { type: Number },           // Google only
    impressions: { type: Number }    // Meta only
}, { _id: false });

const paymentSchema = new mongoose.Schema({
    date: { type: Date },
    transactionId: { type: String },
    modeOfPayment: { type: String },
    amount: { type: Number }
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
    fileName: { type: String, required: true },
    filePath: { type: String }, 
    fileHash: { type: String }, // For duplicate detection
    platform: {
        type: String,
        enum: ['google_ads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'other'],
        required: true
    },
    extractedData: {
        invoiceNumber: String,
        invoiceDate: Date,
        accountId: String,
        accountName: String,
        location: String,
        subtotal: Number,     // without GST
        taxAmount: Number,    // GST
        totalAmount: Number,  // with GST
        currency: String,
        billingPeriod: {
            startDate: Date,
            endDate: Date
        },
        campaigns: [campaignSchema],
        payments: [paymentSchema]
    },
    rawText: String,
    processedAt: { type: Date, default: Date.now },
    status: {
        type: String,
        enum: ['processing', 'completed', 'failed'],
        default: 'processing'
    },
    errorMessage: String
}, { timestamps: true });

// Indexes for efficient querying
invoiceSchema.index({ platform: 1 });
invoiceSchema.index({ 'extractedData.invoiceDate': 1 });
invoiceSchema.index({ 'extractedData.campaigns.campaignName': 1 });
invoiceSchema.index({ processedAt: 1 });
invoiceSchema.index({ fileHash: 1 }); // For duplicate detection
invoiceSchema.index({ fileName: 1 }); // For filename lookups

module.exports = mongoose.model('Invoice', invoiceSchema);