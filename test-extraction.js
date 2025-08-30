const PdfController = require('./controllers/pdfController');
const path = require('path');

async function testExtraction() {
    try {
        const zipPath = path.join(__dirname, 'uploads', 'test-upload.zip');
        console.log('Testing extraction of:', zipPath);
        
        const extractedFiles = await PdfController.extractPdfsFromZip(zipPath);
        console.log('Extraction successful!');
        console.log('Extracted files:', extractedFiles);
        
        // Clean up extracted files
        const fs = require('fs');
        extractedFiles.forEach(file => {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
                console.log('Cleaned up:', file.path);
            }
        });
        
    } catch (error) {
        console.error('Extraction failed:', error);
    }
}

testExtraction();


