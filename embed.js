(function() {
    // Find all embed containers
    const containers = document.querySelectorAll('.grafer-embed');

    containers.forEach(container => {
        const src = container.dataset.src;
        if (!src) return;

        // Create iframe
        const iframe = document.createElement('iframe');
        iframe.src = src;
        iframe.style.width = '100%';
        iframe.style.border = 'none';
        iframe.style.display = 'block';
        iframe.style.overflow = 'hidden';
        iframe.scrolling = 'no';

        // Set initial height (generous to avoid cut-off)
        iframe.style.height = '600px';

        container.appendChild(iframe);
    });

    // Listen for height messages from iframes
    window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'grafer-resize') {
            const iframes = document.querySelectorAll('.grafer-embed iframe');
            iframes.forEach(iframe => {
                if (iframe.contentWindow === e.source) {
                    // Add small buffer to ensure nothing is cut off
                    iframe.style.height = (e.data.height + 5) + 'px';
                }
            });
        }
    });
})();
