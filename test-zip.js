const unzipper = require('unzipper');
const path = require('path');
const fs = require('fs');

async function testZipExtraction() {
    const zipFilePath = path.join(__dirname, 'uploads', 'test-upload.zip');
    console.log('Testing ZIP extraction for:', zipFilePath);
    
    try {
        if (!fs.existsSync(zipFilePath)) {
            console.log('ZIP file does not exist');
            return;
        }
        
        const directory = await unzipper.Open.file(zipFilePath);
        console.log('ZIP file opened successfully');
        console.log('Files in ZIP:', directory.files.length);
        
        for (const file of directory.files) {
            console.log('File:', file.path, 'Type:', file.type, 'Extension:', path.extname(file.path).toLowerCase());
            
            if (file.type === 'File' && path.extname(file.path).toLowerCase() === '.pdf') {
                console.log('Found PDF:', file.path);
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

testZipExtraction();


