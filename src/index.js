const BOT_TOKEN = "7498614075:AAHepFlPgEvvohNwg-BWUrgAW1OrbxEUXeo";
const MY_CHAT_ID = "1283445630";
const WATERMARK = "@biliyormuydunuz";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });

    // 1. İndirilebilir HTML / Görsel Önizleme Sayfası
    if (url.pathname === "/view") {
      return handleViewPage(url);
    }

    // 2. Ham SVG Motoru
    if (url.pathname === "/image") {
      return handleImageGeneration(url);
    }

    // 3. Webhook Kurulumu (/set-webhook)
    if (url.pathname === "/set-webhook") {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 4. Telegram Webhook Gelen Komutlar (/hazirla)
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

    // 5. Tarayıcıdan Manuel Tetikleme (Test Linki)
    try {
      const webhookUrl = `${url.origin}/webhook`;
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);

      const result = await generateAndSendPost(env, MY_CHAT_ID, url.origin);
      return new Response(`İşlem Başarılı!\n\n${result}`, {
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

👇 <i>Aşağıdaki butonlardan formatı seçip görseli cihazınıza kaydedin:</i>`;

  const squareParams = new URLSearchParams({ text: selectedFact.text, img: selectedFact.imageUrl, ratio: "square" });
  const portraitParams = new URLSearchParams({ text: selectedFact.text, img: selectedFact.imageUrl, ratio: "portrait" });

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "📥 Instagram Kare (1:1)", url: `${origin}/view?${squareParams.toString()}` },
        { text: "📥 Instagram Portre (4:5)", url: `${origin}/view?${portraitParams.toString()}` }
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

  return `Gönderildi: ${selectedFact.title}`;
}

// 1 Tıkla PNG Olarak Kaydeden Önizleme ve İndirme Motoru
async function handleViewPage(url) {
  const svgUrl = `/image?${url.searchParams.toString()}`;
  const ratio = url.searchParams.get("ratio") || "square";

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Instagram Gönderi İndir</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background: #0f172a; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .container { max-width: 500px; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 18px; }
    .preview-box { width: 100%; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.6); background: #000; }
    .preview-box img { width: 100%; height: auto; display: block; }
    .btn { width: 100%; padding: 16px; font-size: 17px; font-weight: 700; color: #000; background: #f59e0b; border: none; border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; text-decoration: none; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4); }
    .btn:active { transform: scale(0.98); }
    .tip { font-size: 13px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="preview-box">
      <img id="postImg" src="${svgUrl}" alt="Instagram Post">
    </div>
    <button class="btn" id="downloadBtn" onclick="downloadAsPng()">
      📥 Görseli Galeriye İndir (PNG)
    </button>
    <p class="tip">Butona tıklayarak yazılı ve tasarımlı halini tam çözünürlükte kaydedebilirsiniz.</p>
  </div>

  <script>
    async function downloadAsPng() {
      const btn = document.getElementById('downloadBtn');
      btn.innerText = '⏳ Hazırlanıyor...';
      try {
        const res = await fetch('${svgUrl}');
        const svgText = await res.text();
        
        const width = 1080;
        const height = '${ratio}' === 'portrait' ? 1350 : 1080;
        
        const img = new Image();
        const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        const blobUrl = URL.createObjectURL(svgBlob);
        
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(blobUrl);
          
          const pngUrl = canvas.toDataURL('image/png');
          const a = document.createElement('a');
          a.download = 'instagram_post.png';
          a.href = pngUrl;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          btn.innerText = '✅ İndirildi!';
          setTimeout(() => { btn.innerText = '📥 Görseli Galeriye İndir (PNG)'; }, 2000);
        };
        img.src = blobUrl;
      } catch (err) {
        btn.innerText = '❌ Hata Oluştu';
      }
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

// Görsel SVG Render Motoru (Görseli Base64 Olarak İçine Gömer)
async function handleImageGeneration(url) {
  const text = url.searchParams.get("text") || "Tarihin tozlu raflarında kalmış ilginç ve bilinmeyen detaylar.";
  const bgImg = url.searchParams.get("img") || "";
  const ratio = url.searchParams.get("ratio") || "square";

  const width = 1080;
  const height = ratio === "portrait" ? 1350 : 1080;

  // Görseli indirip Base64 Data URL'e çevir (Tek parça olması için)
  let embeddedImgData = bgImg;
  if (bgImg && bgImg.startsWith("http")) {
    try {
      const imgRes = await fetch(bgImg, { headers: WIKI_HEADERS });
      if (imgRes.ok) {
        const buffer = await imgRes.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        const contentType = imgRes.headers.get("content-type") || "image/jpeg";
        embeddedImgData = `data:${contentType};base64,${base64}`;
      }
    } catch (e) {
      embeddedImgData = bgImg;
    }
  }

  // Metin Satırlama
  const maxLineChars = ratio === "portrait" ? 44 : 48;
  const words = text.toLocaleUpperCase("tr-TR").split(" ");
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

  const lineHeight = 46;
  const totalTextHeight = lines.length * lineHeight;
  
  const bottomMargin = ratio === "portrait" ? 140 : 110;
  const startY = height - bottomMargin - totalTextHeight;
  const titleY = startY - 70;
  const lineY = titleY + 25;

  const tspanLines = lines
    .map((line, idx) => `<tspan x="540" y="${startY + idx * lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&amp;family=Inter:wght@500;700&amp;display=swap');
        
        .header-title {
          font-family: 'Bebas Neue', 'Impact', sans-serif;
          font-size: 56px;
          letter-spacing: 3px;
          fill: #f59e0b;
        }
        .main-text {
          font-family: 'Bebas Neue', 'Impact', sans-serif;
          font-size: 34px;
          letter-spacing: 1.6px;
          word-spacing: 2px;
          fill: #ffffff;
        }
        .watermark-text {
          font-family: 'Inter', sans-serif;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: 0.5px;
          fill: #ffffff;
        }
      </style>

      <linearGradient id="textOnlyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0" />
        <stop offset="48%" stop-color="#000000" stop-opacity="0.25" />
        <stop offset="70%" stop-color="#000000" stop-opacity="0.85" />
        <stop offset="90%" stop-color="#000000" stop-opacity="0.98" />
        <stop offset="100%" stop-color="#000000" stop-opacity="1" />
      </linearGradient>

      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.9"/>
      </filter>
    </defs>

    <rect width="${width}" height="${height}" fill="#0a0a0a" />
    ${embeddedImgData ? `<image href="${embeddedImgData}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="0.95" />` : ""}
    
    <rect width="${width}" height="${height}" fill="url(#textOnlyGrad)" />

    <!-- Sol Üst: Instagram Rozeti -->
    <g transform="translate(60, 65)">
      <rect x="0" y="0" width="44" height="44" rx="12" fill="none" stroke="#ffffff" stroke-width="3" />
      <circle cx="22" cy="22" r="10" fill="none" stroke="#ffffff" stroke-width="3" />
      <circle cx="32" cy="12" r="2.5" fill="#ffffff" />
      <text x="56" y="30" class="watermark-text" filter="url(#softShadow)">
        ${escapeXml(WATERMARK)}
      </text>
    </g>

    <!-- BİLİYOR MUYDUNUZ? Başlığı -->
    <text x="540" y="${titleY}" text-anchor="middle" class="header-title" filter="url(#softShadow)">
      BİLİYOR MUYDUNUZ?
    </text>

    <!-- Ayırıcı Çizgi -->
    <line x1="490" y1="${lineY}" x2="590" y2="${lineY}" stroke="#f59e0b" stroke-width="3.5" stroke-linecap="round" />

    <!-- Gövde Metni -->
    <text text-anchor="middle" class="main-text" filter="url(#softShadow)">
      ${tspanLines}
    </text>

    <!-- Alt Kısım: İkonlar -->
    <g transform="translate(340, ${height - 65})">
      <g stroke="#ffffff" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(0, 0) scale(1.1)">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
      </g>
      <g stroke="#ffffff" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(120, 0) scale(1.1)">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </g>
      <g stroke="#ffffff" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(240, 0) scale(1.1)">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </g>
      <g stroke="#ffffff" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(360, 0) scale(1.1)">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </g>
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
