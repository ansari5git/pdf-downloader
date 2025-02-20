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

        setLoading(true);
        thumbnailsContainer.innerHTML = '';
        downloadOptions.style.display = 'none';

        try {
            // Open SSE connection
            const sseUrl = `/extract-images-sse?pdfUrl=${encodeURIComponent(url)}`;
            const evtSource = new EventSource(sseUrl);

            let queue = [];

            evtSource.onmessage = (event) => {
                const data = JSON.parse(event.data);

                if (data.type === 'imageFound') {
                    queue.push(data.base64);
                    processQueue();
                } else if (data.type === 'done') {
                    evtSource.close();
                    if (data.total > 0) {
                        downloadOptions.style.display = 'flex';
                    }
                } else if (data.error) {
                    evtSource.close();
                    showError(data.error);
                }
            };

            async function processQueue() {
                while (queue.length > 0) {
                    const base64 = queue.shift();

                    const img = document.createElement('img');
                    img.src = `data:image/png;base64,${base64}`;
                    img.alt = 'Extracted page';
                    img.loading = 'lazy';

                    thumbnailsContainer.appendChild(img);
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
