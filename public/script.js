// public/script.js

document.addEventListener('DOMContentLoaded', function() {
  const input = document.getElementById('pdfUrl');
  const pasteBtn = document.getElementById('paste-btn');
  const fetchBtn = document.getElementById('fetchPagesBtn');
  const errorMessage = document.getElementById('error-message');
  const thumbnailsContainer = document.getElementById('thumbnails');
  const downloadOptions = document.getElementById('downloadOptions');
  const loadingMessage = document.getElementById('loadingMessage');

  // Paste functionality
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      input.value = text;
      validateInput();
    } catch (err) {
      showError('Unable to paste from clipboard');
    }
  });

  // Input validation
  input.addEventListener('input', validateInput);

  function validateInput() {
    const value = input.value.trim();
    if (value === '') {
      fetchBtn.disabled = true;
      hideError();
      return;
    }

    try {
      const url = new URL(value);
      if (url.hostname === 'drive.google.com') {
        fetchBtn.disabled = false;
        hideError();
      } else {
        fetchBtn.disabled = true;
        showError('Please enter a valid Google Drive URL');
      }
    } catch {
      fetchBtn.disabled = true;
      showError('Please enter a valid URL');
    }
  }

  // Fetch button click handler
  fetchBtn.addEventListener('click', async () => {
    const url = input.value.trim();

    if (!url) {
      showError('Please enter a Google Drive PDF URL');
      return;
    }

    setLoading(true); // Show the global loader
    thumbnailsContainer.innerHTML = '';
    downloadOptions.style.display = 'none';

    try {
      // SSE approach
      const sseUrl = `/extract-images-sse?pdfUrl=${encodeURIComponent(url)}`;
      const evtSource = new EventSource(sseUrl);

      // We'll store incoming images in a queue
      const queue = [];

      evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'imageFound') {
          // We got a new base64 image
          queue.push(data.base64);
          processQueue(); // Start processing the queue
        } else if (data.type === 'done') {
          // SSE route is done
          evtSource.close();
          setLoading(false); // Hide the global loader
          if (data.total > 0) {
            downloadOptions.style.display = 'flex';
          }
        } else if (data.error) {
          // Error from SSE
          evtSource.close();
          showError(data.error);
          setLoading(false);
        }
      };

      /**
       * Process the queue of base64 images, showing a skeleton for each
       * before replacing it with the actual image.
       */
      async function processQueue() {
        while (queue.length > 0) {
          const base64 = queue.shift();

          // 1) Create a skeleton placeholder
          const skeleton = document.createElement('div');
          skeleton.className = 'skeleton';

          // Optionally add a loading bar inside the skeleton
          const loadingBar = document.createElement('div');
          loadingBar.className = 'loading-bar';
          skeleton.appendChild(loadingBar);

          // Append the skeleton to the thumbnails container
          thumbnailsContainer.appendChild(skeleton);

          // 2) Animate the bar to 100% (fake progress, optional)
          await new Promise(r => setTimeout(r, 100));
          loadingBar.style.width = '100%';

          // Wait a bit so user sees the skeleton
          await new Promise(r => setTimeout(r, 300));

          // 3) Create the real image element
          const img = document.createElement('img');
          img.src = `data:image/png;base64,${base64}`;
          img.alt = 'Extracted page';
          img.loading = 'lazy';

          // 4) Replace the skeleton with the real image
          thumbnailsContainer.replaceChild(img, skeleton);
        }
      }

    } catch (error) {
      showError('Failed to process PDF. Please try again.');
      setLoading(false);
    }
  });

  // Download handlers
  document.getElementById('downloadZipBtn').addEventListener('click', () => {
    const pdfUrl = input.value.trim();
    window.location.href = `/download-zip?pdfUrl=${encodeURIComponent(pdfUrl)}`;
  });

  document.getElementById('downloadPdfBtn').addEventListener('click', () => {
    const pdfUrl = input.value.trim();
    window.location.href = `/download-pdf?pdfUrl=${encodeURIComponent(pdfUrl)}`;
  });

  /**
   * Show or hide the global loader (#loadingMessage)
   */
  function setLoading(isLoading) {
    fetchBtn.disabled = isLoading;
    input.disabled = isLoading;
    pasteBtn.disabled = isLoading;
    loadingMessage.style.display = isLoading ? 'block' : 'none';
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
  }

  function hideError() {
    errorMessage.style.display = 'none';
  }
});
