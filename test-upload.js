const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads');
    },
    filename: (req, file, cb) => {
        cb(null, 'test-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        console.log('=== FILE UPLOAD DEBUG ===');
        console.log('Original name:', file.originalname);
        console.log('MIME type:', file.mimetype);
        console.log('Field name:', file.fieldname);
        console.log('Extension:', path.extname(file.originalname).toLowerCase());
        console.log('========================');
        cb(null, true);
    }
});

app.post('/test-upload', upload.single('file'), (req, res) => {
    console.log('File received:', req.file);
    res.json({ 
        message: 'File uploaded',
        file: req.file
    });
});

app.listen(8080, () => {
    console.log('Test server running on port 8080');
});


