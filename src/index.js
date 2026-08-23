const BOT_TOKEN = "7498614075:AAHepFlPgEvvohNwg-BWUrgAW1OrbxEUXeo";
const MY_CHAT_ID = "1283445630";
const WATERMARK = "@Buguntarihte";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });

    // 1. Instagram Görsel SVG Motoru
    if (url.pathname === "/image") {
      return handleImageGeneration(url);
    }

    // 2. Webhook Kurulumu (/set-webhook)
    if (url.pathname === "/set-webhook") {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 3. Telegram Webhook Gelen Komutlar (/hazirla)
    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        if (update.message && update.message.text) {
          const chatId = String(update.message.chat.id);
          const text = update.message.text.trim().toLowerCase();

          if (text === "/hazirla" || text === "/start" || text === "hazırla" || text === "hazirla") {
            ctx.waitUntil(generateAndSendPost(env, chatId, url.origin));
          }
        }
      } catch (err) {
        console.error("Webhook hatası:", err);
      }
      return new Response("OK", { status: 200 });
    }

    // 4. Tarayıcıdan Manuel Tetikleme (Test Linki)
    try {
      const webhookUrl = `${url.origin}/webhook`;
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);

      const result = await generateAndSendPost(env, MY_CHAT_ID, url.origin);
      return new Response(result || "İşlem tamamlandı.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    } catch (err) {
      return new Response(`Hata Detayı:\n${err.message}\n\n${err.stack}`, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  }
};

const WIKI_HEADERS = {
  "User-Agent": "WikipediaInstagramBot/1.0 (contact: telegramherokuhesabi3@gmail.com)",
  "Accept": "application/json"
};

async function generateAndSendPost(env, chatId, origin) {
  const listUrl = new URL("https://tr.wikipedia.org/w/api.php");
  listUrl.search = new URLSearchParams({
    action: "query",
    list: "allpages",
    apnamespace: "4",
    apprefix: "Biliyor muydunuz",
    aplimit: "500",
    format: "json",
    formatversion: "2"
  });

  const listRes = await fetch(listUrl, { headers: WIKI_HEADERS });
  const listData = await listRes.json();
  const allPages = listData?.query?.allpages || [];

  const validPages = allPages.filter(p => 
    p.title && 
    p.title !== "Vikipedi:Biliyor muydunuz" && 
    !p.title.endsWith("/Arşiv") &&
    !p.title.includes("Şablon")
  );

  const shuffledPages = validPages.sort(() => 0.5 - Math.random());
  let selectedFact = null;

  for (const page of shuffledPages) {
    const parseUrl = new URL("https://tr.wikipedia.org/w/api.php");
    parseUrl.search = new URLSearchParams({
      action: "parse",
      page: page.title,
      format: "json",
      formatversion: "2",
      prop: "wikitext",
      redirects: "1"
    });

    const parseRes = await fetch(parseUrl, { headers: WIKI_HEADERS });
    const parseData = await parseRes.json();
    const wikitext = parseData?.parse?.wikitext || "";

    if (!wikitext) continue;

    const imgMatch = wikitext.match(/\[\[(?:Dosya|Resim|File|Media|Image):([^|\]\n]+)/i);
    if (imgMatch && imgMatch[1]) {
      const fileName = imgMatch[1].trim();
      const imgUrl = await fetchWikipediaImageUrl(fileName);
      if (imgUrl) {
        let cleanText = temizleWikitext(wikitext);
        cleanText = cleanText.replace(/^(?:Vikipedi|Biliyor muydu(?:nuz)?\??|Arşiv|Ana sayfa)[^.!?]*[.!?]?\s*/i, "").trim();

        if (cleanText.includes("...")) {
          const parts = cleanText.split("...");
          const found = parts.find(p => p.trim().length > 30);
          if (found) cleanText = found.trim();
        }

        if (
          cleanText.length > 30 &&
          !cleanText.toLowerCase().includes("standart resim") &&
          !cleanText.toLowerCase().includes("madde önerileri")
        ) {
          selectedFact = {
            title: page.title,
            text: cleanText,
            imageUrl: imgUrl
          };
          break;
        }
      }
    }
  }

  if (!selectedFact) {
    selectedFact = {
      title: "Vikipedi:Biliyor muydunuz",
      text: "Mimar Sinan'ın 'Ustalık Eserim' dediği Edirne'deki Selimiye Camii, 2011 yılında UNESCO Dünya Mirası Listesi'ne dahil edilmiştir.",
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Edirne_Selimiye_Mosque_Dome.jpg/1024px-Edirne_Selimiye_Mosque_Dome.jpg"
    };
  }

  const encodedTitle = encodeURIComponent(selectedFact.title.replace(/ /g, "_"));
  const dynamicSourceUrl = `https://tr.wikipedia.org/wiki/${encodedTitle}`;

  const instagramCaption = 
`💡 Bunu biliyor muydunuz?

${selectedFact.text}

📌 Daha fazla ilginç ve tarihi bilgi için takipte kalın!
.
.
#tarih #tarihtebugun #bunubiliyormuydunuz #bilgi #genelkültür #tarihieser #tariharsivi`;

  const telegramMessage =
`✨ <b>YENİ İNSTAGRAM İÇERİĞİNİZ HAZIR!</b>

📝 <b>Instagram Açıklaması:</b>
<code>${escapeHtml(instagramCaption)}</code>

🔗 <b>Kaynak:</b> <a href="${dynamicSourceUrl}">Vikipedi</a>

👇 <i>Aşağıdaki butonlardan formatı seçip görseli indirebilirsiniz:</i>`;

  const squareParams = new URLSearchParams({ text: selectedFact.text, img: selectedFact.imageUrl, ratio: "square" });
  const portraitParams = new URLSearchParams({ text: selectedFact.text, img: selectedFact.imageUrl, ratio: "portrait" });

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "📥 Instagram Kare (1:1)", url: `${origin}/image?${squareParams.toString()}` },
        { text: "📥 Instagram Portre (4:5)", url: `${origin}/image?${portraitParams.toString()}` }
      ]
    ]
  };

  let sent = false;
  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: selectedFact.imageUrl,
        caption: telegramMessage,
        parse_mode: "HTML",
        reply_markup: replyMarkup
      })
    });
    const tgData = await tgRes.json();
    if (tgData.ok) sent = true;
  } catch (e) {
    console.error(e);
  }

  if (!sent) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: telegramMessage,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
        disable_web_page_preview: false
      })
    });
  }

  return `Başarılı! Gönderildi: ${selectedFact.title}`;
}

// Görsel SVG Render Motoru (Referans Görsele Birebir Uygun)
function handleImageGeneration(url) {
  const text = url.searchParams.get("text") || "Tarihin tozlu raflarında kalmış ilginç ve bilinmeyen detaylar.";
  const bgImg = url.searchParams.get("img") || "";
  const ratio = url.searchParams.get("ratio") || "square";

  const width = 1080;
  const height = ratio === "portrait" ? 1350 : 1080;

  // Cümleyi başlık (ilk 2-3 kelime) ve gövde olarak ikiye ayır
  const words = text.split(" ");
  const titleCount = words.length > 15 ? 3 : (words.length > 5 ? 2 : 1);
  const titleStr = words.slice(0, titleCount).join(" ").toLocaleUpperCase("tr-TR");
  const bodyStr = words.slice(titleCount).join(" ").toLocaleUpperCase("tr-TR");

  // BAŞLIK Satırlama (Büyük Puntolu Bebas Neue)
  const titleLines = [];
  let curT = "";
  for (const w of titleStr.split(" ")) {
    if ((curT + " " + w).trim().length > 12) {
      if (curT) titleLines.push(curT.trim());
      curT = w;
    } else {
      curT += " " + w;
    }
  }
  if (curT) titleLines.push(curT.trim());

  // GÖVDE Satırlama (Normal Puntolu Bebas Neue)
  const maxBodyChars = ratio === "portrait" ? 30 : 34;
  const bodyLines = [];
  let curB = "";
  for (const w of bodyStr.split(" ")) {
    if ((curB + " " + w).trim().length > maxBodyChars) {
      if (curB) bodyLines.push(curB.trim());
      curB = w;
    } else {
      curB += " " + w;
    }
  }
  if (curB) bodyLines.push(curB.trim());

  // Dinamik Yükseklik ve Yerleşim Hesaplamaları
  let currentY = 320; // Biliyor muydunuz? yazısından sonraki başlangıç

  const titleSvg = titleLines.map((line, idx) => {
    // 2. Satırı vurgulamak için Camgöbeği (Cyan) yapıyoruz
    const fill = (idx % 2 === 1) ? "#38b2ac" : "#ffffff";
    const t = `<tspan x="70" y="${currentY}" fill="${fill}">${escapeXml(line)}</tspan>`;
    currentY += 95;
    return t;
  }).join("");

  const bodyStartY = currentY;
  currentY += 20; // Başlık ile gövde arası boşluk

  const bodySvg = bodyLines.map((line) => {
    const t = `<tspan x="90" y="${currentY}">${escapeXml(line)}</tspan>`;
    currentY += 40;
    return t;
  }).join("");

  const bodyEndY = currentY - 40; // Gövdenin bittiği son satırın hizası

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&amp;family=Dancing+Script:wght@700&amp;family=Inter:wght@400;600&amp;display=swap');
        
        .title-text { font-family: 'Bebas Neue', sans-serif; font-size: 100px; font-weight: normal; letter-spacing: 2px; }
        .cursive-text { font-family: 'Dancing Script', cursive; font-size: 60px; fill: #38b2ac; }
        .body-text { font-family: 'Bebas Neue', sans-serif; font-size: 36px; fill: #e2e8f0; letter-spacing: 1.5px; }
        .small-bold { font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 2.5px; fill: #ffffff; }
      </style>

      <!-- Soldan Sağa Siyah Karartma (Sağdaki görseli net bırakır) -->
      <linearGradient id="leftGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#070b0d" stop-opacity="1" />
        <stop offset="45%" stop-color="#070b0d" stop-opacity="0.95" />
        <stop offset="70%" stop-color="#070b0d" stop-opacity="0.4" />
        <stop offset="100%" stop-color="#070b0d" stop-opacity="0" />
      </linearGradient>

      <!-- Okunabilirlik Gölgesi -->
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.9"/>
      </filter>
    </defs>

    <!-- Arka Plan Görseli (Sağa Dayalı - Konuyu ortalar) -->
    <rect width="${width}" height="${height}" fill="#0a0a0a" />
    ${bgImg ? `<image href="${escapeXml(bgImg)}" width="${width}" height="${height}" preserveAspectRatio="xMaxYMid slice" opacity="0.90" />` : ""}
    
    <!-- Soldan Sağa Siyah Degrade -->
    <rect width="${width}" height="${height}" fill="url(#leftGrad)" />

    <!-- Estetik İnce Çerçeve -->
    <rect x="30" y="30" width="${width - 60}" height="${height - 60}" fill="none" stroke="#ffffff" stroke-opacity="0.15" stroke-width="2" />

    <!-- SOL ÜST: Kum Saati İkonu ve "Tarihten Bir Not" -->
    <g transform="translate(60, 60)">
      <g fill="#38b2ac" transform="scale(1.5)">
         <path d="M6 2v6l4 4-4 4v6h12v-6l-4-4 4-4V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5l-4-4V4h8v3.5l-4 4z"/>
      </g>
      <text x="50" y="15" class="small-bold">TARİHTEN</text>
      <text x="50" y="35" class="small-bold">BİR NOT</text>
    </g>

    <!-- "Biliyor muydunuz?" Estetik Yazı -->
    <text x="70" y="210" class="cursive-text" filter="url(#softShadow)">Biliyor muydunuz?</text>
    <line x1="70" y1="240" x2="260" y2="240" stroke="#38b2ac" stroke-width="4" stroke-linecap="round"/>

    <!-- DİNAMİK BAŞLIK (İlk kelimeler Büyük Punto) -->
    <text class="title-text" filter="url(#softShadow)">
      ${titleSvg}
    </text>

    <!-- DİNAMİK GÖVDE (Mavi Dikey Çizgi Eşliğinde) -->
    <g>
      <!-- Sol Dikey Cyan Çizgi -->
      <line x1="70" y1="${bodyStartY - 20}" x2="70" y2="${bodyEndY + 10}" stroke="#38b2ac" stroke-width="5" stroke-linecap="square"/>
      <text class="body-text" filter="url(#softShadow)">
        ${bodySvg}
      </text>
    </g>

    <!-- SOL ALT: Kaydetme İkonu -->
    <g transform="translate(60, ${height - 110})">
      <g stroke="#38b2ac" stroke-width="2" fill="none" transform="scale(1.5)">
        <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
      </g>
      <text x="50" y="15" class="small-bold" fill="#a0aec0">DAHA FAZLASI İÇİN</text>
      <text x="50" y="35" class="small-bold" fill="#38b2ac">KAYDET</text>
    </g>

    <!-- SAĞ ALT: Mini İkonlar ve Slogan -->
    <g transform="translate(${width - 250}, ${height - 100})">
      <g stroke="#ffffff" fill="none" stroke-width="1.5" transform="scale(0.8)">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        <path d="M30 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L12 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" transform="translate(18, 0)"/>
        <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" transform="translate(48, 0)"/>
      </g>
      <text x="180" y="55" text-anchor="end" class="small-bold">TARİHİ KEŞFET, <tspan fill="#38b2ac">GELECEĞİ ANLA.</tspan></text>
    </g>

  </svg>
  `;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400"
    }
  });
}

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function fetchWikipediaImageUrl(fileName) {
  try {
    let cleanName = fileName.replace(/^(?:Dosya|Resim|File|Media|Image):/i, "").trim();

    const imgApiUrl = new URL("https://tr.wikipedia.org/w/api.php");
    imgApiUrl.search = new URLSearchParams({
      action: "query",
      titles: `File:${cleanName}`,
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "1200",
      format: "json",
      formatversion: "2"
    });
    const res = await fetch(imgApiUrl, { headers: WIKI_HEADERS });
    const data = await res.json();
    const pages = data?.query?.pages;
    if (pages && pages[0]?.imageinfo && pages[0].imageinfo[0]) {
      return pages[0].imageinfo[0].thumburl || pages[0].imageinfo[0].url;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function temizleWikitext(s) {
  return String(s || "")
    .replace(/<ref[^>]*\/>/gi, " ")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
    .replace(/<gallery[\s\S]*?<\/gallery>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\[\[(?:Dosya|Resim|File|Media|Image):[^\]]+\]\]/gi, " ")
    .replace(/^.*?betimleyen bir resim\.\s*\]*\]*\s*/i, "")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1")
    .replace(/'{2,3}/g, "")
    .replace(/\b\d{2,4}x\d{2,4}px\b/gi, " ")
    .replace(/^[;*.'"\s\]]+/, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
            }
          }
        }
      } catch (err) {
        console.error("Webhook hatası:", err);
      }
      return new Response("OK", { status: 200 });
    }

    // 4. Tarayıcıdan Manuel Tetikleme (Test Linki)
    try {
      const webhookUrl = `${url.origin}/webhook`;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);

      const result = await generateAndSendPost(env, AUTHORIZED_CHAT_ID, url.origin);
      return new Response(result || "İşlem tamamlandı.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    } catch (err) {
      return new Response(`Hata Detayı:\n${err.message}\n\n${err.stack}`, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  }
};

const WIKI_HEADERS = {
  "User-Agent": "WikipediaInstagramBot/16.0 (contact: telegramherokuhesabi3@gmail.com)",
  "Accept": "application/json"
};

async function generateAndSendPost(env, chatId, origin) {
  const listUrl = new URL("https://tr.wikipedia.org/w/api.php");
  listUrl.search = new URLSearchParams({
    action: "query",
    list: "allpages",
    apnamespace: "4",
    apprefix: "Biliyor muydunuz",
    aplimit: "500",
    format: "json",
    formatversion: "2"
  });

  const listRes = await fetch(listUrl, { headers: WIKI_HEADERS });
  const listData = await listRes.json();
  const allPages = listData?.query?.allpages || [];

  const validPages = allPages.filter(p => 
    p.title && 
    p.title !== "Vikipedi:Biliyor muydunuz" && 
    !p.title.endsWith("/Arşiv") &&
    !p.title.includes("Şablon")
  );

  const shuffledPages = validPages.sort(() => 0.5 - Math.random());
  let selectedFact = null;

  for (const page of shuffledPages) {
    const parseUrl = new URL("https://tr.wikipedia.org/w/api.php");
    parseUrl.search = new URLSearchParams({
      action: "parse",
      page: page.title,
      format: "json",
      formatversion: "2",
      prop: "wikitext",
      redirects: "1"
    });

    const parseRes = await fetch(parseUrl, { headers: WIKI_HEADERS });
    const parseData = await parseRes.json();
    const wikitext = parseData?.parse?.wikitext || "";

    if (!wikitext) continue;

    const imgMatch = wikitext.match(/\[\[(?:Dosya|Resim|File|Media|Image):([^|\]\n]+)/i);
    if (imgMatch && imgMatch[1]) {
      const fileName = imgMatch[1].trim();
      const imgUrl = await fetchWikipediaImageUrl(fileName);
      if (imgUrl) {
        let cleanText = temizleWikitext(wikitext);
        cleanText = cleanText.replace(/^(?:Vikipedi|Biliyor muydu(?:nuz)?\??|Arşiv|Ana sayfa)[^.!?]*[.!?]?\s*/i, "").trim();

        if (cleanText.includes("...")) {
          const parts = cleanText.split("...");
          const found = parts.find(p => p.trim().length > 30);
          if (found) cleanText = found.trim();
        }

        if (
          cleanText.length > 30 &&
          !cleanText.toLowerCase().includes("standart resim") &&
          !cleanText.toLowerCase().includes("madde önerileri")
        ) {
          selectedFact = {
            title: page.title,
            text: cleanText,
            imageUrl: imgUrl
          };
          break;
        }
      }
    }
  }

  if (!selectedFact) {
    selectedFact = {
      title: "Vikipedi:Biliyor muydunuz",
      text: "Osmanlı padişahı III. Osman sarayda dolaşırken cariyelerle karşılaşmak istemediği için ayakkabılarına demir ökçeler taktırmıştı.",
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Osman_III.jpg/1200px-Osman_III.jpg"
    };
  }

  const encodedTitle = encodeURIComponent(selectedFact.title.replace(/ /g, "_"));
  const dynamicSourceUrl = `https://tr.wikipedia.org/wiki/${encodedTitle}`;

  const instagramCaption = 
`💡 Bunu biliyor muydunuz?

${selectedFact.text}

📌 Daha fazla ilginç ve tarihi bilgi için takipte kalın!
.
.
#tarih #tarihtebugun #bunubiliyormuydunuz #bilgi #genelkültür #tarihieser #tariharsivi`;

  const telegramMessage =
`✨ <b>YENİ İNSTAGRAM İÇERİĞİNİZ HAZIR!</b>

📝 <b>Instagram Açıklaması:</b>
<code>${escapeHtml(instagramCaption)}</code>

🔗 <b>Kaynak:</b> <a href="${dynamicSourceUrl}">Vikipedi</a>

👇 <i>Aşağıdan görsel formatını seçip indirin:</i>`;

  const squareParams = new URLSearchParams({ text: selectedFact.text, img: selectedFact.imageUrl, wm: WATERMARK, ratio: "square" });
  const portraitParams = new URLSearchParams({ text: selectedFact.text, img: selectedFact.imageUrl, wm: WATERMARK, ratio: "portrait" });

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "📥 Instagram Kare (1:1)", url: `${origin}/image?${squareParams.toString()}` },
        { text: "📥 Instagram Portre (4:5)", url: `${origin}/image?${portraitParams.toString()}` }
      ]
    ]
  };

  let sent = false;
  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: selectedFact.imageUrl,
        caption: telegramMessage,
        parse_mode: "HTML",
        reply_markup: replyMarkup
      })
    });
    const tgData = await tgRes.json();
    if (tgData.ok) sent = true;
  } catch (e) {
    console.error(e);
  }

  if (!sent) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: telegramMessage,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
        disable_web_page_preview: false
      })
    });
  }

  return `Başarılı! Gönderildi: ${selectedFact.title}`;
}

// Görsel SVG Render Motoru (Genişletilmiş ve Aşağı Konumlandırılmış Tasarım)
function handleImageGeneration(url) {
  const text = url.searchParams.get("text") || "Bunu biliyor muydunuz?";
  const bgImg = url.searchParams.get("img") || "";
  const watermark = url.searchParams.get("wm") || "@Buguntarihte";
  const ratio = url.searchParams.get("ratio") || "square";

  const width = 1080;
  const height = ratio === "portrait" ? 1350 : 1080;

  // Geniş satır sınırları (Soldan sağa daha geniş yayılım, az satır sayısı)
  const maxLineChars = ratio === "portrait" ? 54 : 58;
  const words = text.split(" ");
  const lines = [];
  let cur = "";

  for (const w of words) {
    if ((cur + " " + w).trim().length > maxLineChars) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else {
      cur += " " + w;
    }
  }
  if (cur) lines.push(cur.trim());

  const lineHeight = 42;
  const totalTextHeight = lines.length * lineHeight;
  
  // Metni ve rozeti aşağıda konumlandırma
  const bottomMargin = ratio === "portrait" ? 85 : 65;
  const startY = height - bottomMargin - totalTextHeight;
  const badgeY = startY - 45;

  const tspanLines = lines
    .map((line, idx) => `<tspan x="540" y="${startY + idx * lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&amp;display=swap');
        .main-text {
          font-family: 'Bebas Neue', 'Impact', sans-serif;
          font-size: 31px;
          letter-spacing: 1.2px;
          word-spacing: 2px;
          fill: #ffffff;
        }
        .badge-text {
          font-family: 'Bebas Neue', 'Impact', sans-serif;
          font-size: 22px;
          letter-spacing: 2px;
          fill: #000000;
        }
        .watermark-text {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 19px;
          font-weight: 700;
          letter-spacing: 0.5px;
          fill: #ffffff;
        }
      </style>

      <linearGradient id="bottomGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.02" />
        <stop offset="40%" stop-color="#000000" stop-opacity="0.35" />
        <stop offset="70%" stop-color="#000000" stop-opacity="0.88" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0.97" />
      </linearGradient>

      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.9"/>
      </filter>
    </defs>

    <rect width="${width}" height="${height}" fill="#0a0a0a" />
    ${bgImg ? `<image href="${escapeXml(bgImg)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="0.90" />` : ""}
    <rect width="${width}" height="${height}" fill="url(#bottomGrad)" />

    <!-- Sol Üst Rozet: Instagram İkonu + @Buguntarihte -->
    <g transform="translate(50, 65)">
      <rect x="0" y="0" width="${watermark.length * 14 + 60}" height="44" rx="22" fill="#000000" fill-opacity="0.60" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.5" />
      
      <!-- Instagram SVG Logosu -->
      <g transform="translate(13, 11) scale(0.044)">
        <path fill="#f59e0b" d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z"/>
      </g>

      <text x="44" y="28" class="watermark-text">
        ${escapeXml(watermark)}
      </text>
    </g>

    <!-- BİLİYOR MUYDUNUZ? Rozeti (Aşağı Konumlandırılmış) -->
    <g transform="translate(540, ${badgeY})">
      <rect x="-140" y="-23" width="280" height="46" rx="23" fill="#f59e0b" filter="url(#softShadow)" />
      <text text-anchor="middle" y="7" class="badge-text">
        BİLİYOR MUYDUNUZ?
      </text>
    </g>

    <!-- Bilgi Metni (Soldan Sağa Genişletilmiş & Bebas Neue) -->
    <text text-anchor="middle" class="main-text" filter="url(#softShadow)">
      ${tspanLines}
    </text>
  </svg>
  `;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400"
    }
  });
}

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function fetchWikipediaImageUrl(fileName) {
  try {
    let cleanName = fileName.replace(/^(?:Dosya|Resim|File|Media|Image):/i, "").trim();

    const imgApiUrl = new URL("https://tr.wikipedia.org/w/api.php");
    imgApiUrl.search = new URLSearchParams({
      action: "query",
      titles: `File:${cleanName}`,
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "1200",
      format: "json",
      formatversion: "2"
    });
    const res = await fetch(imgApiUrl, { headers: WIKI_HEADERS });
    const data = await res.json();
    const pages = data?.query?.pages;
    if (pages && pages[0]?.imageinfo && pages[0].imageinfo[0]) {
      return pages[0].imageinfo[0].thumburl || pages[0].imageinfo[0].url;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function temizleWikitext(s) {
  return String(s || "")
    .replace(/<ref[^>]*\/>/gi, " ")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
    .replace(/<gallery[\s\S]*?<\/gallery>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\[\[(?:Dosya|Resim|File|Media|Image):[^\]]+\]\]/gi, " ")
    .replace(/^.*?betimleyen bir resim\.\s*\]*\]*\s*/i, "")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1")
    .replace(/'{2,3}/g, "")
    .replace(/\b\d{2,4}x\d{2,4}px\b/gi, " ")
    .replace(/^[;*.'"\s\]]+/, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
