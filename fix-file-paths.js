const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const Invoice = require('./models/Invoice');

// Helper function to resolve file path correctly
function resolveFilePath(filePath) {
    if (!filePath) return null;
    
    // If it's already an absolute path, check if it exists
    if (path.isAbsolute(filePath)) {
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    
    // Try to resolve relative to uploads directory
    const uploadsDir = path.join(__dirname, 'uploads');
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
    
    return null;
}

async function fixFilePaths() {
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Get all invoices
        const invoices = await Invoice.find({});
        console.log(`Found ${invoices.length} invoices`);

        let fixed = 0;
        let notFound = 0;

        for (const invoice of invoices) {
            if (!invoice.filePath) {
                console.log(`Invoice ${invoice.fileName} has no filePath`);
                continue;
            }

            const resolvedPath = resolveFilePath(invoice.filePath);
            
            if (resolvedPath && resolvedPath !== invoice.filePath) {
                console.log(`Fixing path for ${invoice.fileName}:`);
                console.log(`  Old: ${invoice.filePath}`);
                console.log(`  New: ${resolvedPath}`);
                
                await Invoice.updateOne(
                    { _id: invoice._id },
                    { $set: { filePath: resolvedPath } }
                );
                fixed++;
            } else if (!resolvedPath) {
                console.log(`❌ File not found for ${invoice.fileName}: ${invoice.filePath}`);
                notFound++;
            }
        }

        console.log(`\nSummary:`);
        console.log(`- Fixed: ${fixed} file paths`);
        console.log(`- Not found: ${notFound} files`);
        console.log(`- Total processed: ${invoices.length}`);

    } catch (error) {
        console.error('Error fixing file paths:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

// Run the script
fixFilePaths();
