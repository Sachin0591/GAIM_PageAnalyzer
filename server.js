// 1. Import ALL our tools
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { URL } = require('url'); // We need this to get the port

// 2. Create our web server app
const app = express();
app.use(cors());
app.use(express.json()); 
const PORT = 3000;
// const MASTER_TIMEOUT = 45000; // <-- REMOVED

// 3. --- Set up the Gemini AI Client ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' }); // Use the model that works for you

// --- AI Function 1 (Single Page Report) ---
async function getSinglePageReport(metrics) {
  const prompt = `
    You are an expert Conversion Rate Optimization (CRO) consultant.
    Analyze this JSON data for a single landing page.
    This data includes a "lighthouse" object with Google's official scores (0-100).

    Data: ${JSON.stringify(metrics, null, 2)}

    Provide a "Landing Page Report" with three sections:
    1.  **High-Impact Wins:** Top 3-5 critical issues to fix.
    2.  **Lighthouse Audit:** A brief, human-readable summary of the Lighthouse scores.
    3.  **Detailed Analysis:** Go through the other keys (cta_value, trust, etc.) and explain them.
    Format the entire output in clean Markdown.
  `;
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Error calling Gemini (Single Page):", error);
    return `Error: Could not get analysis from Gemini. ${error.message}`; 
  }
}

// --- AI Function 2 (Competitor Report) ---
async function getCompetitorReport(metrics1, metrics2) {
  const prompt = `
    You are an expert Conversion Rate Optimization (CRO) and Competitive Strategy consultant.
    Analyze the two JSON data objects below. "My Page" is metrics1, "Competitor" is metrics2.

    My Page (metrics1): ${JSON.stringify(metrics1, null, 2)}
    
    Competitor (metrics2): ${JSON.stringify(metrics2, null, 2)}

    Provide a "Strategic Showdown Report" in clean Markdown.
    The report MUST have three sections, wrapped in these exact HTML comment tags:

    <!--START_WINNING-->
    **Strategic Insights (Where You're Winning):**
    * (List 2-3 areas where 'My Page' is objectively better, in bullet points.)
    <!--END_WINNING-->

    <!--START_LOSING-->
    **Key Weaknesses (Why You're Losing):**
    * (List 2-3 critical areas where the 'Competitor' is objectively better, in bullet points.)
    <!--END_LOSING-->

    <!--START_ACTION-->
    **Action to Take:**
    * (Based on the single biggest gap, what is the #1 thing 'My Page' must do right now to beat the competition? Be specific and actionable. Use bullet points for steps.)
    <!--END_ACTION-->
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Error calling Gemini (Competitor):", error);
    return `Error: Could not get comparison from Gemini. ${error.message}`; 
  }
}

// --- AI Function 3 (Interactive Chatbot) ---
async function getChatResponse(question, context) {
  console.log("Starting new AI chat session...");

  const systemPrompt = `
    You are "Analyzer Pro," an expert CRO consultant. A user has just run an analysis and has follow-up questions.
    You MUST use the provided data and report context to answer their questions.
    Be helpful, expert, and actionable. If they ask for advice, give it.
    If they ask you to write copy, do it.

    This is the data from their report:
    Report: ${context.report}
    Raw Data 1: ${JSON.stringify(context.rawData1)}
    Raw Data 2: ${context.rawData2 ? JSON.stringify(context.rawData2) : 'N/A'}
  `;

  try {
    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "model", parts: [{ text: "Understood. I have reviewed the full report and data. How can I help you improve your page?" }] },
      ],
      generationConfig: { maxOutputTokens: 1000 },
    });
    const result = await chat.sendMessage(question);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Error in Gemini Chat:", error);
    return `Error: Could not get chat response. ${error.message}`;
  }
}


// --- "Lighthouse-Lite" Function ---
async function runLighthouse(url, port) {
    console.log(`Running Lighthouse audit for: ${url}`);
    try {
        const { default: lighthouse } = await import('lighthouse');
        
        const settings = {
            port: port,
            output: 'json',
            onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
            logLevel: 'info',
            skipAudits: [
                'diagnostics', 
                'unused-javascript', 
                'unused-css-rules', 
                'full-page-screenshot', 
                'network-requests'
            ]
        };

        const { lhr } = await lighthouse(url, settings);
        
        const scores = {
            performance: Math.round(lhr.categories.performance.score * 100),
            accessibility: Math.round(lhr.categories.accessibility.score * 100),
            bestPractices: Math.round(lhr.categories['best-practices'].score * 100),
            seo: Math.round(lhr.categories.seo.score * 100)
        };
        console.log('Lighthouse scores:', scores);
        return scores;
    } catch (error) {
        console.error("Error running Lighthouse:", error.message);
        return { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 }; 
    }
}

// --- Scraper Function ---
async function scrapePageMetrics(page) {
    console.log('Page is stable, running scraping script...');
    
    const metrics = await page.evaluate(() => {
        const parseNumber = (text) => {
            if (!text) return 0;
            return parseFloat(text.replace(/[^0-9.]/g, ''));
        };
        const pageText = (document.body.innerText || '').toLowerCase();
        const viewportHeight = window.innerHeight;

        // 1. CTA & Value Prop
        const h1Element = document.querySelector('h1');
        const h1Text = h1Element ? h1Element.innerText : 'No H1 tag was found.';
        const ctaKeywords = ['add to cart', 'buy now', 'shop now', 'add to bag', 'go to cart'];
        const allElements = document.querySelectorAll('a, button');
        let ctasAboveFoldCount = 0;
        let foundAddToCartAboveFold = false;
        let foundBuyNowAboveFold = false;
        allElements.forEach(el => {
            const text = el.innerText.toLowerCase().trim();
            const isCta = ctaKeywords.some(keyword => text.includes(keyword));
            if (isCta) {
                const position = el.getBoundingClientRect();
                const isAboveFold = position.top > 0 && position.top < viewportHeight;
                if (isAboveFold) {
                    ctasAboveFoldCount++;
                    if (text.includes('add to cart') || text.includes('add to bag')) foundAddToCartAboveFold = true;
                    if (text.includes('buy now')) foundBuyNowAboveFold = true;
                }
            }
        });
        const hasCompetingCtas = foundAddToCartAboveFold && foundBuyNowAboveFold;
        let hasScannableBenefits = false;
        if (h1Element) {
            const parent = h1Element.parentElement.parentElement;
            if (parent && parent.querySelector('ul')) hasScannableBenefits = true;
        }

        // 2. Social Proof
        let reviewScore = 0;
        let reviewCount = 0;
        const scoreMatch = pageText.match(/(\d\.\d|\d)\s*★/);
        if (scoreMatch && scoreMatch[1]) reviewScore = parseNumber(scoreMatch[1]);
        const countMatch = pageText.match(/([\d,]+)\s+ratings/i);
        if (countMatch && countMatch[1]) reviewCount = parseNumber(countMatch[1]);
        
        // 3. Trust & Risk Reversal
        const trustKeywords = ['warranty', 'assured', 'secure', 'official'];
        const riskKeywords = ['return policy', 'free returns', 'cod', 'cash on delivery', 'days return'];
        const paymentKeywords = ['emi', 'visa', 'mastercard', 'upi', 'klarna', 'afterpay', 'paypal'];
        const hasTrustSignal = trustKeywords.some(keyword => pageText.includes(keyword));
        const hasRiskReversal = riskKeywords.some(keyword => pageText.includes(keyword));
        const hasPaymentOptions = paymentKeywords.some(keyword => pageText.includes(keyword));

        // 4. Friction & Page Hygiene
        const navElement = document.querySelector('header') || document.querySelector('nav') || document.querySelector('[role="navigation"]');
        let navLinkCount = 0;
        if (navElement) navLinkCount = navElement.querySelectorAll('a').length;
        let heroImageVisible = false;
        let usesModernImageFormat = false;
        const allImages = document.querySelectorAll('img');
        for (const img of allImages) {
            const rect = img.getBoundingClientRect();
            if (rect.top > 0 && rect.top < viewportHeight && rect.width > 100) {
                heroImageVisible = true;
                const imgSrc = img.src || '';
                if (imgSrc.includes('.webp') || imgSrc.includes('.avif')) usesModernImageFormat = true;
                break; 
            }
        }
        let paragraphCountAboveFold = 0;
        const allParagraphs = document.querySelectorAll('p');
        allParagraphs.forEach(p => {
            const rect = p.getBoundingClientRect();
            if (rect.top > 0 && rect.top < viewportHeight && p.innerText.length > 10) paragraphCountAboveFold++;
        });

        // 5. Persuasion & Urgency
        let urgencyText = null;
        let scarcityText = null;
        const urgencyMatch = pageText.match(/(delivery by|get it by|ships by) (.*?)(?=\n)/i);
        if (urgencyMatch && urgencyMatch[0]) urgencyText = urgencyMatch[0];
        
        const scarcityMatch = pageText.match(/(\d+|only) (left in stock|left)/i);
        if (scarcityMatch && scarcityMatch[0]) scarcityText = scarcityMatch[0];
        
        // 6. Advanced Price Clarity
        let discountHonesty = 'N/A';
        let salePrice = 0;
        let originalPrice = 0;
        const discountMatch = pageText.match(/(\d{1,2})% off/);
        let statedDiscount = discountMatch ? parseNumber(discountMatch[1]) : 0;
        const originalPriceEl = document.querySelector('s, strike, del, div[class*="strike"], div[class*="Strike"]');
        if (originalPriceEl) originalPrice = parseNumber(originalPriceEl.innerText);
        const salePriceEl = document.querySelector('div[class*="Price"], div[class*="price"], span[class*="Price"], span[class*="price"]');
        if (salePriceEl) salePrice = parseNumber(salePriceEl.innerText);
        if (salePrice > 0 && originalPrice > 0 && statedDiscount > 0) {
            const calculatedDiscount = Math.round((1 - (salePrice / originalPrice)) * 100);
            if (Math.abs(calculatedDiscount - statedDiscount) <= 3) discountHonesty = 'Honest';
            else discountHonesty = 'Deceptive';
        }

        // 7. Return metrics
        return {
            cta_value: { h1: h1Text, ctasAboveFold: ctasAboveFoldCount, hasCompetingCtas: hasCompetingCtas, hasScannableBenefits: hasScannableBenefits },
            socialProof: { reviewScore: reviewScore, reviewCount: reviewCount },
            trust: { hasTrustSignal: hasTrustSignal, hasRiskReversal: hasRiskReversal, hasPaymentOptions: hasPaymentOptions },
            friction: { navLinkCount: navLinkCount, paragraphCountAboveFold: paragraphCountAboveFold },
            performance: { usesModernImageFormat: usesModernImageFormat, discountHonesty: discountHonesty },
            persuasion: { urgencyText: urgencyText, scarcityText: scarcityText }
        };
    });
    return metrics;
}

// --- This function now controls the flow ---
async function runFullAnalysis(url, browser, page) {
    const browserWSEndpoint = browser.wsEndpoint();
    const port = new URL(browserWSEndpoint).port;
    
    // "Impatient Analyst" - Navigate ONCE
    console.log(`Page loading for ${url}... waiting for network to be idle...`);
    // Increase timeout to 30s to be safer
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

    // Run Lighthouse (will attach to the page, not re-navigate)
    const lighthouseScores = await runLighthouse(url, port);
    
    // Run Scraper (will run on the page that is already open)
    const scrapedMetrics = await scrapePageMetrics(page);
    
    return {
        ...scrapedMetrics,
        lighthouse: lighthouseScores
    };
}

// --- UPDATED: Main API Endpoint (Timeouts REMOVED) ---
app.post('/analyze', async (req, res) => {
  const { url1, url2 } = req.body;
  if (!url1) {
    return res.status(400).send({ error: 'url1 is required.' });
  }

  console.log(`Analyzing: ${url1}`);
  if (url2) console.log(`Comparing with: ${url2}`);

  let browser;
  try {
    browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
            '--disable-setuid-sandbox', // special permissions for hosting
          '--remote-debugging-port=0'] // Use 0 to find a random free port
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // --- Master Timeout REMOVED for Page 1 ---
    let metrics1;
    try {
      // This is the original, simple call. It will wait as long as it needs.
      metrics1 = await runFullAnalysis(url1, browser, page);
    } catch (e) {
      console.error(e.message);
      throw new Error(e.message); // Send this error to the main catch block
    }

    let metrics2 = null;
    let analysisReport = '';

    if (url2) {
        // --- Master Timeout REMOVED for Page 2 ---
         try {
            // This is the original, simple call. It will wait as long as it needs.
            metrics2 = await runFullAnalysis(url2, browser, page);
        } catch (e) {
            console.error(e.message);
            throw new Error(e.message); // Send this error to the main catch block
        }
        
        console.log('Got both metrics. Sending to Gemini for comparison...');
        analysisReport = await getCompetitorReport(metrics1, metrics2);
    } else {
        console.log('Got metrics. Sending to Gemini for analysis...');
        analysisReport = await getSinglePageReport(metrics1);
    }
    
    res.send({
      report: analysisReport,
      rawData1: metrics1,
      rawData2: metrics2 
    });

  } catch (error) {
    console.error('Error during analysis:', error);
    res.status(500).send({ error: `Failed to analyze the page: ${error.message}` });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// --- Chat Endpoint ---
app.post('/chat', async (req, res) => {
  const { question, context } = req.body;

  if (!question || !context) {
    return res.status(400).send({ error: 'A question and context are required.' });
  }

  try {
    const chatResponse = await getChatResponse(question, context);
    res.send({ answer: chatResponse });
  } catch (error) {
    console.error('Error in /chat endpoint:', error);
    res.status(500).send({ error: `Failed to get chat response: ${error.message}` });
  }
});


// 10. Start our server
app.listen(PORT, () => {
  console.log(`Server is running and listening on http://localhost:${PORT}`);
});