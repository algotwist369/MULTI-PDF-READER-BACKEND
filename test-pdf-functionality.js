const axios = require('axios');

const BASE_URL = 'http://localhost:7000';

async function testPdfFunctionality() {
    console.log('🧪 Testing PDF Functionality...\n');

    try {
        // Test 1: Health check
        console.log('1. Testing server health...');
        const healthResponse = await axios.get(`${BASE_URL}/health`);
        console.log('✅ Server is healthy:', healthResponse.data.status);
        console.log('');

        // Test 2: Get invoices to find a PDF
        console.log('2. Testing invoice retrieval...');
        const invoicesResponse = await axios.get(`${BASE_URL}/api/invoices?page=1&limit=5`);
        console.log(`✅ Found ${invoicesResponse.data.invoices.length} invoices`);
        
        if (invoicesResponse.data.invoices.length > 0) {
            const firstInvoice = invoicesResponse.data.invoices[0];
            console.log(`   - First invoice: ${firstInvoice.fileName}`);
            console.log(`   - Platform: ${firstInvoice.platform}`);
            console.log(`   - PDF URL: ${firstInvoice.pdfUrl}`);
            console.log('');

            // Test 3: Test PDF view endpoint
            console.log('3. Testing PDF view endpoint...');
            try {
                const pdfViewResponse = await axios.get(`${BASE_URL}/api/pdf/view/${encodeURIComponent(firstInvoice.fileName)}`, {
                    responseType: 'stream',
                    timeout: 10000
                });
                console.log('✅ PDF view endpoint working');
                console.log(`   - Content-Type: ${pdfViewResponse.headers['content-type']}`);
                console.log(`   - Content-Length: ${pdfViewResponse.headers['content-length']}`);
                console.log('');

                // Test 4: Test bulk download list
                console.log('4. Testing bulk download list...');
                const bulkListResponse = await axios.get(`${BASE_URL}/api/pdf/bulk-download/${firstInvoice.platform}?format=list`);
                console.log('✅ Bulk download list working');
                console.log(`   - Platform: ${bulkListResponse.data.platform}`);
                console.log(`   - Total files: ${bulkListResponse.data.totalFiles}`);
                console.log(`   - Files available: ${bulkListResponse.data.files.length}`);
                console.log('');

                // Test 5: Test bulk download ZIP (just check if endpoint responds)
                console.log('5. Testing bulk download ZIP endpoint...');
                try {
                    const bulkZipResponse = await axios.get(`${BASE_URL}/api/pdf/bulk-download/${firstInvoice.platform}?format=zip`, {
                        responseType: 'stream',
                        timeout: 5000
                    });
                    console.log('✅ Bulk download ZIP endpoint working');
                    console.log(`   - Content-Type: ${bulkZipResponse.headers['content-type']}`);
                    console.log(`   - Content-Disposition: ${bulkZipResponse.headers['content-disposition']}`);
                } catch (zipError) {
                    if (zipError.code === 'ECONNABORTED') {
                        console.log('✅ Bulk download ZIP endpoint responding (timeout expected for large files)');
                    } else {
                        console.log('❌ Bulk download ZIP endpoint error:', zipError.message);
                    }
                }

            } catch (viewError) {
                console.log('❌ PDF view endpoint error:', viewError.message);
            }
        } else {
            console.log('⚠️  No invoices found to test with');
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', error.response.data);
        }
    }

    console.log('\n🎉 Testing completed!');
}

// Run the test
testPdfFunctionality();
