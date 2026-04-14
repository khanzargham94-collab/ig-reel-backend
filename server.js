const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

// Health check endpoint for Render cold starts
app.get('/', (req, res) => res.status(200).send('IG Reel API is awake.'));

// Helper to extract Reel ID
const extractReelId = (url) => {
    const match = url.match(/(?:reel|p)\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : 'unknown';
};

app.post('/reel', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }

    // Clean URL
    const cleanUrl = url.split('?')[0];
    const reelId = extractReelId(cleanUrl);

    let browser = null;
    let video_url = null;
    let error_message = 'Failed to extract video';
    let success = false;

    // Retry logic (2 attempts)
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            console.log(`[Attempt ${attempt}] Processing: ${cleanUrl}`);
            
            // Highly optimized arguments for 512MB Free Tier limits
            browser = await chromium.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--single-process',
                    '--no-zygote'
                ]
            });

            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            });

            const page = await context.newPage();
            
            // Abort unnecessary resources to save bandwidth and memory
            await page.route('**/*', route => {
                const type = route.request().resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });

            await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(3500); // Allow dynamic DOM injection

            // Check for login wall
            const loginWall = await page.$('input[name="username"]');
            if (loginWall) throw new Error('Instagram login wall encountered');

            // Extract the OpenGraph video meta tag
            video_url = await page.getAttribute('meta[property="og:video"]', 'content', { timeout: 5000 });

            if (video_url) {
                success = true;
                break; // Break loop if successful
            } else {
                throw new Error('og:video meta tag not found in DOM');
            }
            
        } catch (error) {
            console.error(`Attempt ${attempt} error:`, error.message);
            error_message = error.message;
        } finally {
            if (browser) await browser.close();
        }
    }

    if (success) {
        return res.json({ success: true, video_url, reel_id: reelId });
    } else {
        return res.status(500).json({ success: false, error: error_message, reel_id: reelId });
    }
});

// Render provides PORT dynamically
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server binding to 0.0.0.0:${PORT}`);
});
