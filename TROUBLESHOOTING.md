# Production Troubleshooting Guide

## PDF Download Issues

### Problem: "PDF file not found on server" error

This error occurs when the file paths stored in the database don't match the actual file locations in production.

### Solutions:

1. **Run the file path fix script:**
   ```bash
   npm run fix-paths
   ```

2. **Use the debug endpoint to check file paths:**
   ```
   GET /api/pdf/debug/{fileName}
   ```
   This will show you:
   - Original file path in database
   - Resolved file path
   - Whether the file exists
   - Files in uploads directory
   - Matching files

3. **Manual database check:**
   ```javascript
   // Connect to MongoDB and check file paths
   db.invoices.find({}, {fileName: 1, filePath: 1})
   ```

### Common Issues:

1. **Absolute paths from development**: File paths stored as absolute paths from your local machine
2. **Missing uploads directory**: The uploads folder doesn't exist in production
3. **File permissions**: Files exist but can't be read due to permissions

### Prevention:

- Always use relative paths in development
- Ensure uploads directory exists and has proper permissions
- Run the fix script after deployment

## Rate Limiting Issues

### Problem: "X-Forwarded-For header" error

This occurs when Express is behind a reverse proxy but doesn't trust it.

### Solution:

The `trust proxy` setting has been added to `server.js`:
```javascript
app.set('trust proxy', 1);
```

## CORS Issues

### Problem: Frontend can't connect to backend

### Solution:

CORS has been updated to include your production frontend URL:
```javascript
origin: ['*', 'https://daily.dosadsexpence.in']
```

## Deployment Checklist

1. ✅ Stop current PM2 process
2. ✅ Pull latest code
3. ✅ Install dependencies
4. ✅ Run file path fix script
5. ✅ Start server with PM2
6. ✅ Save PM2 configuration

## Monitoring

### Check server status:
```bash
pm2 status
pm2 logs pdf-ai-reader
```

### Check file paths:
```bash
curl https://ads.api.d0s369.co.in/api/pdf/debug/{fileName}
```

### Test uploads directory:
```bash
ls -la /path/to/your/app/uploads/
```

## Emergency Fixes

### If files are completely missing:
1. Re-upload the PDFs
2. The system will process them again

### If database is corrupted:
1. Backup current data
2. Restore from backup
3. Re-run file path fix script

### If server won't start:
1. Check PM2 logs: `pm2 logs pdf-ai-reader`
2. Check Node.js version compatibility
3. Verify environment variables
4. Check file permissions
