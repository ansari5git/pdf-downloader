const express = require('express');
const puppeteer = require('puppeteer');
const JSZip = require('jszip');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

// Simple form for demonstration
app.get('/', (req, res) => {
    res.send(`
    <h1>GDrive PDF Image Downloader (Fixed Version)</h1>
    <form method="POST" action="/download-images">
      <label>Enter Shared GDrive PDF Link:</label><br/>
      <input type="text" name="pdfUrl" style="width:400px"/>
      <button type="submit">Download Images</button>
    </form>
  `);
});

app.post('/download-images', async (req, res) => {
    const pdfUrl = req.body.pdfUrl || "";
    const fileId = extractFileId(pdfUrl);

    // Validate the Google Drive link
    if (!fileId) {
        return res.send("Invalid Google Drive link or File ID not found.");
    }

    // Construct the 'preview' URL
    const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;

    let browser;
    try {
        // 1) Launch Puppeteer
        browser = await puppeteer.launch({
    headless: 'new',  // Use new headless mode
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',  // Prevent /dev/shm issues
        '--single-process',          // Needed for resource-constrained environments
        '--no-zygote'                // Disable zygote process
    ]
});
        const page = await browser.newPage();

        // 2) Intercept requests to capture PDF page images
        let imageUrls = [];
        await page.setRequestInterception(true);
        page.on('request', reqIntercept => {
            const url = reqIntercept.url();
            reqIntercept.continue(); // allow the request

            if (/drive\.google\.com\/viewer2\/prod-\d+\/img/.test(url)) {
                const pageMatch = url.match(/page=(\d+)/);
                const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : -1;

                // Only proceed if pageNum is valid
                if (pageNum < 0) return;

                // For the first 3 pages, allow only the first image (no duplicates)
                if (pageNum < 3) {
                    if (!imageUrls.some(url => url.includes(`page=${pageNum}`))) {
                        imageUrls.push(url);
                    }
                } else {
                    // For the rest, store all images or compare for resolution
                    imageUrls.push(url);
                }
            }
        });

        // 3) Open the PDF preview page
        await page.goto(previewUrl, {
            waitUntil: 'networkidle2'
        });

        // 4) Scroll until all images are captured
        let lastCount = 0;
        let stableIterations = 0;
        let maxScrolls = 200; // Safety limit to prevent infinite loops

        while (stableIterations < 5 && maxScrolls > 0) {
            console.log(`Scrolling... Current captured images: ${imageUrls.length}`);

            await page.mouse.wheel({
                deltaY: 1000
            }); // Scroll down
            await page.waitForTimeout(2500); // Wait for images to load

            const currentCount = imageUrls.length;
            if (currentCount === lastCount) {
                stableIterations++; // No new images => Increment counter
            } else {
                stableIterations = 0; // Reset if new images are found
                lastCount = currentCount;
            }

            maxScrolls--; // Prevent infinite loops

            // If scroll limit reached but still images are being captured, reset and continue
            if (maxScrolls <= 0 && stableIterations < 5) {
                console.log("Max scroll attempts reached, retrying to capture remaining images...");
                maxScrolls = 100; // Reset max scroll attempts for recovery
            }

            // Stop if there are no new images for 5 consecutive checks
            if (stableIterations >= 5) {
                console.log("No new images detected. Stopping scroll.");
                break;
            }
        }

        console.log(`Total Images Captured: ${imageUrls.length}`);

        // Remove duplicate URLs while preserving order
        const uniqueImageUrls = [];
        const seen = new Set();

        for (const url of imageUrls) {
            if (!seen.has(url)) {
                seen.add(url);
                uniqueImageUrls.push(url);
            }
        }

        imageUrls = uniqueImageUrls;
        console.log(`Total Unique Images Captured: ${imageUrls.length}`);

        if (!imageUrls.length) {
            console.error("No images found. PDF might not have fully loaded.");
            return res.send("No page images found. Try increasing wait time.");
        }

        // 5) Fetch each image & put it in a ZIP
        const zip = new JSZip();
        const imageFetchPromises = imageUrls.map(async (url, index) => {
            try {
                const resp = await fetch(url);
                const buf = await resp.buffer();
                zip.file(`page-${index + 1}.jpg`, buf); // Add the image to ZIP
            } catch (err) {
                console.error("Failed to fetch image:", url, err);
            }
        });

        // Wait for all image fetches to complete concurrently
        await Promise.all(imageFetchPromises);


        // 6) Send the ZIP file to the user
        const zipContent = await zip.generateAsync({
            type: 'nodebuffer'
        });
        res.setHeader('Content-Disposition', 'attachment; filename="pdf-images.zip"');
        res.setHeader('Content-Type', 'application/zip');
        res.send(zipContent);

    } catch (err) {
        console.error(err);
        return res.send("An error occurred while processing the PDF.");
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

function extractFileId(url) {
    const match = url.match(/[-\w]{25,}/);
    return match ? match[0] : null;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});