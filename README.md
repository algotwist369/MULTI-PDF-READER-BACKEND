# Multi-PDF Invoice Data Extraction App - Server

A Node.js server application for extracting structured data from PDF invoices using AI/ML techniques.

## Features

- PDF upload and processing
- AI-powered data extraction using OpenAI GPT-4
- Support for multiple advertising platforms (Google Ads, Meta Ads, Facebook Ads, Instagram Ads)
- RESTful API endpoints
- MongoDB database integration
- Rate limiting and security middleware
- File upload handling with validation

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (local or cloud instance)
- OpenAI API key

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the server directory with the following variables:
```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/pdf-invoice-reader
OPENAI_API_KEY=your_openai_api_key_here
```

3. Start the server:
```bash
# Development mode
npm run dev

# Production mode
npm start
```

## API Endpoints

### Health Check
- `GET /health` - Server health status

### PDF Processing
- `POST /api/pdf/upload` - Upload PDF files for processing
- `GET /api/pdf/status/:fileName` - Get processing status for a specific file

### Invoice Management
- `GET /api/invoices` - Get all invoices with filtering and pagination
- `GET /api/invoices/:id` - Get invoice by ID
- `GET /api/invoices/platform/:platform` - Get invoices by platform
- `GET /api/invoices/analytics/summary` - Get analytics summary
- `DELETE /api/invoices/:id` - Delete invoice by ID

## Query Parameters

### Invoice Filtering
- `platform` - Filter by platform (google_ads, meta_ads, facebook_ads, instagram_ads, other, all)
- `startDate` - Filter by start date (ISO format)
- `endDate` - Filter by end date (ISO format)
- `campaignName` - Filter by campaign name (partial match)
- `page` - Page number for pagination
- `limit` - Number of items per page (max 100)
- `sortBy` - Sort field (default: processedAt)
- `sortOrder` - Sort order (asc/desc, default: desc)

## File Upload

- Maximum file size: 10MB per file
- Maximum files per upload: 200
- Supported format: PDF only
- Files are automatically cleaned up after processing

## Database Schema

The application uses MongoDB with the following schema for invoices:

```javascript
{
  fileName: String,
  platform: String,
  extractedData: {
    invoiceNumber: String,
    invoiceDate: Date,
    totalAmount: Number,
    currency: String,
    clicks: Number,
    impressions: Number,
    ctr: Number,
    cpc: Number,
    cpm: Number,
    campaignName: String,
    adAccountId: String,
    billingPeriod: {
      startDate: Date,
      endDate: Date
    },
    taxAmount: Number,
    serviceFee: Number
  },
  rawText: String,
  processedAt: Date,
  status: String,
  errorMessage: String
}
```

## Error Handling

The application includes comprehensive error handling:
- File validation errors
- Database connection errors
- OpenAI API errors
- Processing errors with fallback extraction
- Rate limiting errors

## Security Features

- Helmet.js for security headers
- CORS configuration
- Rate limiting (100 requests per 15 minutes per IP)
- File type validation
- Input validation and sanitization

## Development

The project structure:
```
server/
├── config/
│   └── db.js          # Database configuration
├── controllers/
│   ├── invoiceController.js
│   └── pdfController.js
├── models/
│   └── Invoice.js
├── routes/
│   ├── invoiceRoutes.js
│   └── pdfRoutes.js
├── services/
│   └── pdfProcessor.js
├── uploads/            # Temporary file storage
├── server.js           # Main server file
└── package.json
```
