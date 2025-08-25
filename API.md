# API Documentation

## Base URL
```
http://localhost:3000
```

## Authentication
Currently, the API doesn't require authentication. In production, consider adding JWT or API key authentication.

## Rate Limiting
- 100 requests per 15 minutes per IP address

## Endpoints

### Health Check
**GET** `/health`

Returns server health status.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456
}
```

### PDF Upload
**POST** `/api/pdf/upload`

Upload PDF files for processing.

**Headers:**
```
Content-Type: multipart/form-data
```

**Body:**
- `pdfs` (file[]): PDF files to upload (max 200 files, 10MB each)

**Response:**
```json
{
  "message": "Processed 5 files",
  "successful": 4,
  "failed": 1,
  "results": [
    {
      "fileName": "invoice1.pdf",
      "platform": "google_ads",
      "extractedData": { ... },
      "status": "completed"
    }
  ]
}
```

### Get Processing Status
**GET** `/api/pdf/status/:fileName`

Get processing status for a specific file.

**Response:**
```json
{
  "fileName": "invoice1.pdf",
  "status": "completed",
  "platform": "google_ads",
  "extractedData": { ... },
  "errorMessage": null
}
```

### Get All Invoices
**GET** `/api/invoices`

Get all invoices with filtering and pagination.

**Query Parameters:**
- `platform` (string): Filter by platform
- `startDate` (string): Filter by start date (ISO format)
- `endDate` (string): Filter by end date (ISO format)
- `campaignName` (string): Filter by campaign name
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20, max: 100)
- `sortBy` (string): Sort field (default: processedAt)
- `sortOrder` (string): Sort order - 'asc' or 'desc' (default: desc)

**Response:**
```json
{
  "invoices": [
    {
      "_id": "...",
      "fileName": "invoice1.pdf",
      "platform": "google_ads",
      "extractedData": { ... },
      "status": "completed",
      "processedAt": "2024-01-01T00:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalInvoices": 100,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### Get Invoice by ID
**GET** `/api/invoices/:id`

Get a specific invoice by its ID.

**Response:**
```json
{
  "_id": "...",
  "fileName": "invoice1.pdf",
  "platform": "google_ads",
  "extractedData": { ... },
  "rawText": "Full PDF text content...",
  "status": "completed",
  "processedAt": "2024-01-01T00:00:00.000Z"
}
```

### Get Invoices by Platform
**GET** `/api/invoices/platform/:platform`

Get invoices filtered by platform.

**Path Parameters:**
- `platform`: One of 'google_ads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'other'

**Query Parameters:**
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20)

**Response:**
```json
{
  "platform": "google_ads",
  "invoices": [ ... ],
  "pagination": { ... }
}
```

### Get Analytics
**GET** `/api/invoices/analytics/summary`

Get analytics summary across all platforms.

**Query Parameters:**
- `platform` (string): Filter by platform
- `startDate` (string): Filter by start date (ISO format)
- `endDate` (string): Filter by end date (ISO format)

**Response:**
```json
{
  "analytics": [
    {
      "_id": "google_ads",
      "totalInvoices": 50,
      "totalAmount": 15000.00,
      "totalClicks": 50000,
      "totalImpressions": 1000000,
      "avgCPC": 0.30,
      "avgCPM": 15.00,
      "avgCTR": 5.0
    }
  ]
}
```

### Delete Invoice
**DELETE** `/api/invoices/:id`

Delete a specific invoice by its ID.

**Response:**
```json
{
  "message": "Invoice deleted successfully"
}
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Validation error",
  "message": "Invalid platform parameter"
}
```

### 404 Not Found
```json
{
  "error": "Invoice not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "Database connection failed"
}
```

## Data Models

### Invoice Schema
```json
{
  "fileName": "string",
  "platform": "string (enum)",
  "extractedData": {
    "invoiceNumber": "string",
    "invoiceDate": "date",
    "totalAmount": "number",
    "currency": "string",
    "clicks": "number",
    "impressions": "number",
    "ctr": "number",
    "cpc": "number",
    "cpm": "number",
    "campaignName": "string",
    "adAccountId": "string",
    "billingPeriod": {
      "startDate": "date",
      "endDate": "date"
    },
    "taxAmount": "number",
    "serviceFee": "number"
  },
  "rawText": "string",
  "processedAt": "date",
  "status": "string (enum)",
  "errorMessage": "string"
}
```

### Platform Values
- `google_ads`
- `meta_ads`
- `facebook_ads`
- `instagram_ads`
- `other`

### Status Values
- `processing`
- `completed`
- `failed`
