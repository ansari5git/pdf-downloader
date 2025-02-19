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

  try {
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
