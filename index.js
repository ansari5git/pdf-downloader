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
  const fileId = extractFileId(pdfUrl);
  if (!fileId) throw new Error("Invalid Google Drive link or File ID not found.");

  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  let browser;
  let imageUrls = [];

  try {
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

    // Visit the preview page
    await page.goto(previewUrl, { waitUntil: 'networkidle2', timeout: 0 });
    await new Promise(resolve => setTimeout(resolve, 3000)); // Extra delay to ensure images start loading

    // Enable request interception
    await page.setRequestInterception(true);
    page.on('request', (reqIntercept) => {
      const url = reqIntercept.url();
      reqIntercept.continue();

      // Check if this request is a PDF page image
      if (/drive\.google\.com\/viewer2\/prod-\d+\/img/.test(url)) {
        imageUrls.push(url);
      }
    });

    // Reload the preview page so interception is active
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

    return buffers; // Each Buffer represents a page image
  } finally {
    if (browser) {
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

  try {
    const buffers = await extractPdfImages(pdfUrl);
    // Convert Buffers to base64 so front-end can display <img src="data:image/jpeg;base64,...">
    const base64Images = buffers.map(buf => buf.toString('base64'));
    imageCache.set(fileId, buffers);
    res.json({ images: base64Images });
  } catch (err) {
    console.error(err);
    res.json({ error: err.message || "Failed to extract images." });
  }
});

// ======= ROUTE 2: Download a ZIP of all extracted images =======
app.get('/download-zip', async (req, res) => {
  const pdfUrl = req.query.pdfUrl || "";
  const fileId = extractFileId(pdfUrl);
  if (!pdfUrl) {
    return res.send("No PDF URL provided.");
  }

  try {
    // 1) Check cache
    
    let buffers = imageCache.get(fileId);


    
    // 2) If not cached, run Puppeteer
    
    if (!buffers) {
      
      buffers = await extractPdfImages(pdfUrl);
      
      imageCache.set(fileId, buffers);
      }

    const zip = new JSZip();
    buffers.forEach((buf, idx) => {
      zip.file(`page-${idx + 1}.jpg`, buf);
    });

    const zipContent = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Disposition', 'attachment; filename="pdf-images.zip"');
    res.setHeader('Content-Type', 'application/zip');
    res.send(zipContent);
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

  try {
    // 1) Check if we already have images in the cache
    
    let buffers = imageCache.get(fileId);

   
 
    // 2) If not cached, re-run Puppeteer
    
    if (!buffers) {
      
      buffers = await extractPdfImages(pdfUrl);
      
      imageCache.set(fileId, buffers);
    
      }

    // Use pdf-lib to build a PDF from the extracted images
    const pdfDoc = await PDFDocument.create();
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
    res.setHeader('Content-Disposition', 'attachment; filename="pdf-images.pdf"');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBytes));
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
