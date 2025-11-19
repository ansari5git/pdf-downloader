import express from 'express';
import puppeteer from 'puppeteer';
import JSZip from 'jszip';
import fetch from 'node-fetch';
import { PDFDocument } from 'pdf-lib'; // (NEW) for building a PDF from images
import path from 'path';
import { fileURLToPath } from 'url';

// Simple cache images: fileId -> array of Buffers (each buffer is one page image)
const imageCache = new Map();

// (NEW) Handle __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// (NEW) Serve static files (index.html, style.css, script.js) from /public
app.use(express.static(path.join(__dirname, 'public')));

// (UNCHANGED) Helper function to extract GDrive file ID
function extractFileId(url) {
  const match = url.match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

// (NEW) Encapsulated Puppeteer logic into a helper function
async function extractPdfImages(pdfUrl) {
  // ADDED: Log the start of extraction
  
  console.log("[extractPdfImages] Starting PDF image extraction for:", pdfUrl);
  const fileId = extractFileId(pdfUrl);
  if (!fileId) throw new Error("Invalid Google Drive link or File ID not found.");

  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  let browser;
  let imageUrls = [];

  try {
    // ADDED: Indicate Puppeteer is launching
    
    console.log("[extractPdfImages] Launching Puppeteer...");
    browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome-stable',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
      ],
    });
    const page = await browser.newPage();

    // Visit the preview page
    await page.goto(previewUrl, { waitUntil: 'networkidle2', timeout: 0 });
    await new Promise(resolve => setTimeout(resolve, 3000)); // Extra delay to ensure images start loading

    // Enable request interception
    await page.setRequestInterception(true);
    page.on('request', (reqIntercept) => {
  const url = reqIntercept.url();
  reqIntercept.continue();

  if (/drive\.google\.com\/viewer2\/prod-\d+\/img/.test(url)) {
    const match = url.match(/page=(\d+)/);
    const pageNum = match ? parseInt(match[1], 10) : -1;
    if (pageNum < 0) return;

    // For the first 3 pages, only store the first image
    if (pageNum < 3) {
      if (!imageUrls.some(existingUrl => existingUrl.includes(`page=${pageNum}`))) {
        // ADDED: Log when we store first 3 pages
            
        console.log(`[extractPdfImages] Storing first image for page ${pageNum}:`, url);
        imageUrls.push(url);
      }
    } else {
      // For the rest, store all
      imageUrls.push(url);
    }
  }
});

    // Reload the preview page so interception is active
    console.log("[extractPdfImages] Reloading preview page..."); // ADDED
    await page.goto(previewUrl, { waitUntil: 'networkidle2' });

    // Scroll to load all page images
    let lastCount = 0;
    let stableIterations = 0;
    let maxScrolls = 200;
    while (stableIterations < 5 && maxScrolls > 0) {
      console.log(`Scrolling... Current captured images: ${imageUrls.length}`);
      await page.mouse.wheel({ deltaY: 1000 });
      await new Promise(r => setTimeout(r, 2000)); // Wait a bit after each scroll

      const currentCount = imageUrls.length;
      if (currentCount === lastCount) {
        stableIterations++;
      } else {
        stableIterations = 0;
        lastCount = currentCount;
      }
      maxScrolls--;
    }

    // Remove duplicates
    const uniqueUrls = [...new Set(imageUrls)];
    if (!uniqueUrls.length) {
      throw new Error("No page images found. Try increasing wait time.");
    }

    // ADDED: Log how many unique URLs found
    
    console.log("[extractPdfImages] Unique image URLs found:", uniqueUrls.length);

    // Fetch each image as a Buffer
    const buffers = [];
    for (const url of uniqueUrls) {
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        buffers.push(Buffer.from(arrayBuffer));
      } catch (err) {
        console.error("Failed to fetch image:", url, err);
      }
    }

    // ADDED: Log how many buffers were finally collected
    
    console.log("[extractPdfImages] Total buffers fetched:", buffers.length);

    return buffers; // Each Buffer represents a page image
  } finally {
    if (browser) {
      // ADDED: Indicate browser closing
      
      console.log("[extractPdfImages] Closing Puppeteer browser...");
      await browser.close();
    }
  }
}

// ======= ROUTE 1: Extract images & return base64 for thumbnail preview =======
app.post('/extract-images', async (req, res) => {
  const { pdfUrl } = req.body;
  if (!pdfUrl) {
    return res.json({ error: "No PDF URL provided." });
  }

// ADDED: Log that user requested bulk extraction
  
console.log("[POST /extract-images] User requested extraction for:", pdfUrl);

  try {
    const buffers = await extractPdfImages(pdfUrl);
    // Convert Buffers to base64 so front-end can display <img src="data:image/jpeg;base64,...">
    const base64Images = buffers.map(buf => buf.toString('base64'));
    const fileId = extractFileId(pdfUrl);
    imageCache.set(fileId, buffers);

    // ADDED: Log success + number of images
    
    console.log(`[POST /extract-images] Extraction success. Storing ${buffers.length} images in cache. FileID: ${fileId}`);

    res.json({ images: base64Images });
  } catch (err) {
    console.error(err);
    res.json({ error: err.message || "Failed to extract images." });
  }
});

/* ------------------------------------------------------------------
   2) NEW ROUTE: GET /extract-images-sse
      Streams each image in real time (SSE), storing them in cache.
------------------------------------------------------------------ */
app.get('/extract-images-sse', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const pdfUrl = req.query.pdfUrl || '';
  const fileId = extractFileId(pdfUrl);
  if (!fileId) {
    res.write(`data: ${JSON.stringify({ error: 'Invalid or missing PDF URL' })}\n\n`);
    return res.end();
  }

  // ADDED: Log SSE route start
  
  console.log("[GET /extract-images-sse] SSE route triggered. PDF URL:", pdfUrl);

  let browser;
  // We'll store the final Buffers here
  const buffers = [];

  try {
    const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;

    // ADDED: Indicate Puppeteer launching for SSE
    
    console.log("[GET /extract-images-sse] Launching Puppeteer for SSE...");

    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome-stable',
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
      ],
    });
    const page = await browser.newPage();

    // For first-3-pages logic, we track page->first image
    const firstThreeStored = new Set(); // store pageNums for which we've saved an image

    await page.setRequestInterception(true);
    page.on('request', async (reqIntercept) => {
      const url = reqIntercept.url();
      reqIntercept.continue();

      if (/drive\.google\.com\/viewer2\/prod-\d+\/img/.test(url)) {
        try {
          // Parse page number
          const match = url.match(/page=(\d+)/);
          const pageNum = match ? parseInt(match[1], 10) : -1;
          if (pageNum < 0) return;

          // For first 3 pages, only store the first image
          if (pageNum < 3) {
            if (firstThreeStored.has(pageNum)) {
              return; // skip
            } else {
              // ADDED: Log storing first image for SSE
              
              console.log(`[GET /extract-images-sse] Storing first image for page ${pageNum}:`, url);
              firstThreeStored.add(pageNum);
            }
          } else {
            // ADDED: Log storing subsequent pages
            
            console.log(`[GET /extract-images-sse] Storing image for page ${pageNum}:`, url);
          }
          // Now fetch the image data
          const resp = await fetch(url);
          const ab = await resp.arrayBuffer();
          const buf = Buffer.from(ab);

          // Add to our buffers
          buffers.push(buf);

          // Send SSE event with base64
          const base64 = buf.toString('base64');
          res.write(`data: ${JSON.stringify({ type: 'imageFound', base64 })}\n\n`);
        } catch (err) {
          console.error('Failed to fetch image data:', err);
        }
      }
    });

    // Navigate to preview
    await page.goto(previewUrl, { waitUntil: 'networkidle2', timeout: 0 });

    // Scroll logic
    let lastCount = 0;
    let stableIterations = 0;
    let maxScrolls = 200;
    while (stableIterations < 5 && maxScrolls > 0) {
      await page.mouse.wheel({ deltaY: 1000 });
      await new Promise(r => setTimeout(r, 2000));
      if (buffers.length === lastCount) {
        stableIterations++;
      } else {
        stableIterations = 0;
        lastCount = buffers.length;
      }
      maxScrolls--;
    }

    // Done: store in cache
    imageCache.set(fileId, buffers);
  
    // ADDED: Log SSE completion
    
    console.log(`[GET /extract-images-sse] SSE extraction complete. Total images: ${buffers.length}. Storing in cache.`);

    // Send "done" event
    res.write(`data: ${JSON.stringify({ type: 'done', total: buffers.length })}\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  } finally {
    if (browser) {
      console.log("[GET /extract-images-sse] Closing Puppeteer browser for SSE route..."); // ADDED
      await browser.close();
    }
  }
});


// ======= ROUTE 2: Download a ZIP of all extracted images =======
app.get('/download-zip', async (req, res) => {
  const pdfUrl = req.query.pdfUrl || "";
  const fileId = extractFileId(pdfUrl);
  if (!pdfUrl) {
    return res.send("No PDF URL provided.");
  }

  // ADDED: Log that user requested ZIP download
  
  console.log("[GET /download-zip] User requested ZIP for PDF URL:", pdfUrl);

  try {
    // 1) Check cache
    
    let buffers = imageCache.get(fileId);


    
    // 2) If not cached, run Puppeteer
    
    if (!buffers) {
 
      console.log("[GET /download-zip] No cache found. Extracting images..."); // ADDED     
      buffers = await extractPdfImages(pdfUrl);
      
      imageCache.set(fileId, buffers);
      } else {
        // ADDED: Using cached images
      
        console.log(`[GET /download-zip] Using cached images. Count: ${buffers.length}`);
      }

    const zip = new JSZip();
    buffers.forEach((buf, idx) => {
      zip.file(`page-${idx + 1}.jpg`, buf);
    });

    // ADDED: Indicate building ZIP
    
    console.log(`[GET /download-zip] Building ZIP with ${buffers.length} images...`);
    const zipContent = await zip.generateAsync({ type: 'nodebuffer' });

    // ADDED: Sending ZIP to user
    
    console.log("[GET /download-zip] Sending ZIP file to user...");
    res.setHeader('Content-Disposition', 'attachment; filename="pdf-images.zip"');
    res.setHeader('Content-Type', 'application/zip');
    res.send(zipContent);

    console.log("[GET /download-zip] ZIP download complete.");
  } catch (err) {
    console.error(err);
    res.send("Error generating ZIP: " + err.message);
  }
});

// ======= ROUTE 3: Download a new PDF containing all extracted images =======
app.get('/download-pdf', async (req, res) => {
  const pdfUrl = req.query.pdfUrl || "";
  const fileId = extractFileId(pdfUrl);
  if (!pdfUrl) {
    return res.send("No PDF URL provided.");
  }

  // ADDED: Log user requested PDF download
  
  console.log("[GET /download-pdf] User requested PDF for:", pdfUrl);

  try {
    // 1) Check if we already have images in the cache
    
    let buffers = imageCache.get(fileId);

   
 
    // 2) If not cached, re-run Puppeteer
    
    if (!buffers) {

      console.log("[GET /download-pdf] No cache found. Extracting images..."); // ADDED      
      buffers = await extractPdfImages(pdfUrl);
      
      imageCache.set(fileId, buffers);
    
      } else {
     // ADDED: Using cached images for PDF
      
     console.log(`[GET /download-pdf] Using cached images. Count: ${buffers.length}`);
    
      }

    // Use pdf-lib to build a PDF from the extracted images
    const pdfDoc = await PDFDocument.create();
    console.log(`[GET /download-pdf] Building PDF with ${buffers.length} images...`); // ADDED
    for (const buf of buffers) {
      const pngImage = await pdfDoc.embedPng(buf);
      const page = pdfDoc.addPage([pngImage.width, pngImage.height]);
      page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: pngImage.width,
        height: pngImage.height,
      });
    }

    const pdfBytes = await pdfDoc.save();
    console.log("[GET /download-pdf] PDF generation complete. Sending to user..."); // ADDED
    res.setHeader('Content-Disposition', 'attachment; filename="pdf-images.pdf"');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBytes));
    
    console.log("[GET /download-pdf] PDF download complete.");
  } catch (err) {
    console.error(err);
    res.send("Error generating PDF: " + err.message);
  }
});

// ======= START THE SERVER =======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
