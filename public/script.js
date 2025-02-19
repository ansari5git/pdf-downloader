// public/script.js

// 1. Fetch pages when "Fetch Pages" button is clicked
document.getElementById('fetchPagesBtn').addEventListener('click', async () => {
  const pdfUrl = document.getElementById('pdfUrl').value.trim();
  if (!pdfUrl) {
    alert('Please enter a valid Google Drive PDF link.');
    return;
  }

  // Clear any old thumbnails
  const thumbnailsContainer = document.getElementById('thumbnails');
  thumbnailsContainer.innerHTML = '';
  document.getElementById('downloadOptions').style.display = 'none';

  /* try {
    // Call server to extract images
    const response = await fetch('/extract-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfUrl })
    });
    const data = await response.json();

    if (data.error) {
      alert(data.error);
      return;
    }

    if (!data.images || !data.images.length) {
      alert("No images found or extraction failed.");
      return;
    }

    // Display each image as a thumbnail
    data.images.forEach((base64, index) => {
      const img = document.createElement('img');
      img.src = `data:image/jpeg;base64,${base64}`;
      img.alt = `Page ${index + 1}`;
      thumbnailsContainer.appendChild(img);
    });

    // Show download buttons
    document.getElementById('downloadOptions').style.display = 'block';

  } catch (err) {
    console.error(err);
    alert("An error occurred while fetching pages.");
  }
}); */

// Open SSE connection
const sseUrl = `/extract-images-sse?pdfUrl=${encodeURIComponent(pdfUrl)}`;
const evtSource = new EventSource(sseUrl);

// We'll store incoming base64 images in a queue
let loadingNext = false;
const queue = [];

evtSource.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'imageFound') {
    // We got a new base64 image
    queue.push(data.base64);
    processQueue();
  }
  else if (data.type === 'done') {
    console.log('All images found. total =', data.total);
    evtSource.close();

    if (data.total > 0) {
      // Show download buttons if at least 1 page
      document.getElementById('downloadOptions').style.display = 'block';
    }
  }
  else if (data.error) {
    console.error('SSE error:', data.error);
    evtSource.close();
    alert(data.error);
  }
};

async function processQueue() {
  if (loadingNext) return;
  if (queue.length === 0) return;

  loadingNext = true;
  const base64 = queue.shift();

  // 1) Create skeleton
  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton';

  const loadingBar = document.createElement('div');
  loadingBar.className = 'loading-bar';
  skeleton.appendChild(loadingBar);

  // Insert skeleton into the thumbnails container
  thumbnailsContainer.appendChild(skeleton);

  // 2) Animate the bar to 100% (fake progress)
  await new Promise(r => setTimeout(r, 100));
  loadingBar.style.width = '100%';

  // Wait a bit so user sees the bar fill
  await new Promise(r => setTimeout(r, 500));

  // 3) Replace skeleton with the actual <img>
  const img = document.createElement('img');
  img.src = `data:image/png;base64,${base64}`;
  img.style.width = '150px';
  img.style.height = '200px';

  skeleton.parentNode.replaceChild(img, skeleton);

  loadingNext = false;
  if (queue.length > 0) {
    processQueue();
  }
}
});

// 2. Download as ZIP
document.getElementById('downloadZipBtn').addEventListener('click', () => {
  const pdfUrl = document.getElementById('pdfUrl').value.trim();
  window.location.href = `/download-zip?pdfUrl=${encodeURIComponent(pdfUrl)}`;
});

// 3. Download as PDF
document.getElementById('downloadPdfBtn').addEventListener('click', () => {
  const pdfUrl = document.getElementById('pdfUrl').value.trim();
  window.location.href = `/download-pdf?pdfUrl=${encodeURIComponent(pdfUrl)}`;
});
