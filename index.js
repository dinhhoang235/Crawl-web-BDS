// Import puppeteer with stealth plugin to avoid detection as a bot
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { url1 } = require('./urls');
puppeteer.use(StealthPlugin());

// Add these at the top with other imports
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx')

// Helper function to pause execution for specified milliseconds
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Add this right after the puppeteer setup but before main()
const validListings = [];
const excelFile = path.join(__dirname, 'valid_listings.xlsx');

// Helper function to format date strings
function formatDateForExcel(dateText) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let resultDate;

  if (dateText.includes("Đăng hôm nay")) {
    resultDate = today;
  } else if (dateText.includes("Đăng hôm qua")) {
    resultDate = yesterday;
  } else {
    // Return the original text if it's not today or yesterday
    return dateText;
  }

  // Format as dd/mm/yy
  const day = String(resultDate.getDate()).padStart(2, '0');
  const month = String(resultDate.getMonth() + 1).padStart(2, '0');
  const year = String(resultDate.getFullYear())

  return `${day}/${month}/${year}`;
}

// Helper function to combine new data with existing Excel data
async function combineExcelData(newData, excelFilePath) {
  try {
    let existingData = [];

    // Check if the Excel file already exists
    if (fs.existsSync(excelFilePath)) {
      console.log(`📊 Existing Excel file found at: ${excelFilePath}`);
      // Read existing data
      const workbook = XLSX.readFile(excelFilePath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      existingData = XLSX.utils.sheet_to_json(worksheet);
      console.log(`📊 Loaded ${existingData.length} existing records`);
    }

    // Create a map of existing URLs to avoid duplicates
    const existingUrls = new Map();
    existingData.forEach(item => {
      existingUrls.set(item.URL, true);
    });

    // Filter out duplicates from new data
    const uniqueNewData = newData.filter(item => !existingUrls.has(item.URL));
    console.log(`📊 Found ${uniqueNewData.length} new unique listings to add`);

    // Combine existing data with new unique data
    const combinedData = [...existingData, ...uniqueNewData];

    return combinedData;
  } catch (error) {
    console.error(`❌ Error combining Excel data: ${error.message}`);
    // If there's an error, just return the new data
    return newData;
  }
}

async function main() {
  // Initialize browser with security settings
  const browser = await puppeteer.launch({
    headless: true, // Run browser in headless mode (no GUI)
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Security flags
  });

  // Open a new browser page
  const page = await browser.newPage();
  // Navigate to BatDongSan with filters for Hanoi rentals between 8-60 million VND
  await page.goto(url1, {
    waitUntil: 'domcontentloaded', // Wait until DOM content is loaded
    timeout: 60000 // 60 seconds timeout for page loading
  });

  // Initialize pagination variables
  let currentPage = 1;
  let continuePaginating = true;
  let consecutiveNoRecentPages = 0;
  let hasFoundRecentBefore = false;

  // Main pagination loop
  while (continuePaginating) {
    console.log(`📄 Đang xử lý trang ${currentPage}...`); // Log current page being processed
    // await page.screenshot({ path: `page-${currentPage}.png`, fullPage: true }); // Take screenshot for debugging

    // Select all property listing elements on the page
    const itemElements = await page.$$('.js__card-full-web .js__product-link-for-product-id');
    console.log('🔍 Total items:', itemElements.length); // Log number of items found

    // Flag to check if we found any recent posts on this page
    let foundRecentPost = false;

    // Loop through each property listing
    for (const [index, item] of itemElements.entries()) {
      let retries = 3; // Number of retry attempts for each item
      let success = false;

      // Retry loop for handling potential errors
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          // Extract the published date text from the listing
          const publishedText = await item.$eval(
            '.re__card-published-info-published-at',
            el => el.innerText.trim()
          );

          console.log(`🗓️ Ngày đăng: ${publishedText}`); // Log when the listing was published

          // Check if the listing was published yesterday or today
          const isToday = publishedText.includes("Đăng hôm nay");
          const isYesterday = publishedText.includes("Đăng hôm qua");

          // If we found a recent post, set the flag
          if (isToday || isYesterday) {
            foundRecentPost = true;
          }

          // Skip this listing if it's not from yesterday or today
          if (!isToday && !isYesterday) {
            console.log(`⏭️ Bỏ qua tin cũ: ${publishedText}`);
            success = true; // Mark as success to avoid retries
            break; // Exit the retry loop for this item
          }

          // Extract the location text using correct selector
          const locationText = await item.$eval(
            '.re__card-location span:last-child',
            el => el.innerText.trim()
          ).catch(() => '');

          console.log(`📍 Địa điểm: ${locationText}`);

          // Define the list of desired districts in Hanoi
          const desiredDistricts = [
            'Cầu Giấy', 'Đống Đa', 'Ba Đình', 'Bắc Từ Liêm',
            'Nam Từ Liêm', 'Tây Hồ', 'Hoàng Mai',
            'Hai Bà Trưng', 'Thanh Xuân', 'Hà Đông'
          ];

          // Check if the location contains any of the desired districts
          const isDesiredLocation = desiredDistricts.some(district =>
            locationText.toLowerCase().includes(district.toLowerCase())
          );

          // Skip this listing if it's not in a desired location
          if (!isDesiredLocation) {
            console.log(`⏭️ Bỏ qua vị trí không phù hợp: ${locationText}`);
            success = true; // Mark as success to avoid retries
            break; // Exit the retry loop for this item
          }

          // Get the link to the detail page of the listing
          const linkHandle = await item.getProperty('href');
          const link = await linkHandle.jsonValue();

          // Improve link cleaning to handle line breaks and ensure proper URL structure
          let cleanLink = link.replace(/\s+/g, '');

          // Ensure the URL starts with the correct domain
          if (!cleanLink.startsWith('https://batdongsan.com.vn')) {
            // Try to extract a valid URL if possible
            const match = link.match(/https:\/\/batdongsan\.com\.vn\/[^\s]*/);
            if (match) {
              cleanLink = match[0];
            }
          }

          // Make sure there are no line breaks or invalid characters in the URL
          cleanLink = cleanLink.replace(/[\n\r\t]/g, '');

          // Validate URL before proceeding
          if (!cleanLink.startsWith('https://batdongsan.com.vn')) {
            console.log(`⚠️ [${index}] Invalid link skipped: ${cleanLink}`);
            success = true; // Mark as success to avoid retries
            break; // Exit the retry loop for this item
          }

          // Open the detail page in a new tab
          const detailPage = await browser.newPage();
          await detailPage.goto(cleanLink, { waitUntil: 'domcontentloaded', timeout: 60000 });

          // Check if the agent profile link is present
          const element = await detailPage.$('.re__contact-link a[tracking-id="navigate-agent-profile"]');
          let isValid = true;

          if (element) {
            // Có "xem thêm" → xử lý số tin
            const text = await detailPage.evaluate(el => el.innerText.trim().toLowerCase(), element);

            if (text.includes('xem thêm')) {
              const match = text.match(/xem thêm\s*(\d+)/);
              const count = parseInt(match?.[1]) || 0;
              isValid = count <= 3;
              console.log(`📌 [${index}] Số tin của agent: ${count}`);
            } else {
              console.log(`📌 [${index}] Không có thông tin về số tin của agent`);
              isValid = true;
            }
          } else {
            console.log(`📌 [${index}] Không tìm thấy 'xem thêm'`);

            const moigioi = await detailPage.$eval('.re__ldp-agent-desc', el => el.innerText.trim()).catch(() => null);
            if (moigioi && moigioi.includes('Môi giới chuyên nghiệp')) {
              isValid = false;
              console.log(`👔 [${index}] Môi giới chuyên nghiệp - ${cleanLink}`);
            } else {
              isValid = true;
            }
          }

          if (isValid) {
            const listingInfo = {
              link: cleanLink,
              date: publishedText,
              location: locationText
            };
            validListings.push(listingInfo);

            console.log(`✅ [${index}] Tin Hợp lệ`);
            console.log(`   Full URL: ${cleanLink}`);
          } else {
            console.log(`❌ [${index}] Tin bị loại (xem thêm > 3)`);
            console.log(`   URL: ${cleanLink}`);
          }


          // Close the detail page tab
          await detailPage.close();
          success = true;
          break;

        } catch (err) {
          console.error(`🔥 Lỗi xử lý item ${index} (attempt ${attempt}):`, err.message);
          if (attempt < retries) {
            console.log(`🔁 Thử lại sau 2 giây...`);
            await delay(2000);
          }
        }
      }

      if (!success) {
        console.log(`🚫 [${index}] Bỏ qua sau ${retries} lần thử.`);
      }

      if (!continuePaginating) break;
    }

    // Check if we found any recent posts on this page
    if (foundRecentPost) {
      // Reset counter if we found recent posts
      consecutiveNoRecentPages = 0;
      hasFoundRecentBefore = true;
      console.log('✅ Found recent posts on this page.');
    } else {
      // Only increase counter if we've previously found recent posts
      if (hasFoundRecentBefore) {
        consecutiveNoRecentPages++;
        console.log(`⚠️ No recent posts found: ${consecutiveNoRecentPages} consecutive pages`);

        // Stop pagination after 3 consecutive pages with no recent posts
        if (consecutiveNoRecentPages >= 15) {
          console.log(`🛑 No recent posts found for 15 consecutive pages. Stopping search at page ${currentPage}.`);
          continuePaginating = false;
          break;
        }
      } else {
        console.log('⏳ No recent posts yet, continuing search...');
      }
    }

    if (!continuePaginating) break;

    // Check for the next page button
    const nextBtn = await page.$('a.re__pagination-icon > i.re__icon-chevron-right--sm');

    if (nextBtn) {
      // Get the href of the next page
      const nextHref = await page.evaluate(() => {
        const icon = document.querySelector('a.re__pagination-icon > i.re__icon-chevron-right--sm');
        const aTag = icon?.closest('a');
        return aTag ? aTag.href : null;
      });

      if (nextHref) {
        console.log('➡️ Chuyển đến:', nextHref);
        await page.goto(nextHref, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await delay(2000);
        currentPage++;
      } else {
        console.log('⚠️ Không tìm thấy href của trang kế tiếp.');
      }
    } else {
      console.log('🚫 Không còn trang kế tiếp.');
      continuePaginating = false;
    }
  }

  // Save to Excel file
  // Replace the Excel saving code in main() with this code

  // Save to Excel file
  try {
    // Format data for Excel
    const excelData = validListings.map(item => ({
      'Date': formatDateForExcel(item.date),
      'Location': item.location,
      'URL': item.link
    }));

    // Combine with existing data
    const combinedData = await combineExcelData(excelData, excelFile);

    // Create a new workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(combinedData);

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Valid Listings');

    // Set column widths for better readability
    const columnWidths = [
      { wch: 25 },  // Date column
      { wch: 40 },  // Location column
      { wch: 75 }   // URL column (wide enough for long URLs)
    ];
    worksheet['!cols'] = columnWidths;

    // Write to file
    XLSX.writeFile(workbook, excelFile);
    console.log(`📊 Exported ${combinedData.length} listings (${validListings.length} new + ${combinedData.length - validListings.length} existing) to Excel: ${excelFile}`);
  } catch (error) {
    console.error(`❌ Failed to create Excel file: ${error.message}`);
  }

  // Close the browser
  await browser.close();
}

// Run the main function and handle any errors
main().catch(err => {
  console.error('Lỗi chính:', err);
  // process.exit(1);
});