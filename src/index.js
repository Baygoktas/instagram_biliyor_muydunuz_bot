const TELEGRAM_BOT_TOKEN = "7498614075:AAHepFlPgEvvohNwg-BWUrgAW1OrbxEUXeo";
const AUTHORIZED_CHAT_ID = "1283445630";
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
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
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
          const text = update.message.text.trim();

          if (chatId === String(AUTHORIZED_CHAT_ID)) {
            if (text === "/hazirla" || text === "/start" || text.toLowerCase() === "hazırla" || text.toLowerCase() === "hazirla") {
              ctx.waitUntil(generateAndSendPost(env, chatId, url.origin));
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
  "User-Agent": "WikipediaInstagramBot/14.0 (contact: telegramherokuhesabi3@gmail.com)",
  "Api-User-Agent": "WikipediaInstagramBot/14.0 (contact: telegramherokuhesabi3@gmail.com)",
  "Accept": "application/json"
};

async function fetchWithRetry(url, options = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, options);
    if (res.status !== 429 && res.status !== 503) return res;
    await new Promise(r => setTimeout(r, (i + 1) * 1500));
  }
  return fetch(url, options);
}

async function generateAndSendPost(env, chatId, origin) {
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const start = new Date("2010-01-01T00:00:00Z");

  const randomMs = Math.floor(Math.random() * (cutoff.getTime() - start.getTime()));
  const targetDate = new Date(start.getTime() + randomMs);
  const targetDateStr = targetDate.toISOString().slice(0, 10);

  const listUrl = new URL("https://tr.wikipedia.org/w/api.php");
  listUrl.search = new URLSearchParams({
    action: "query",
    list: "allpages",
    apnamespace: "4",
    apprefix: "Biliyor_muydunuz?/",
    aplimit: "50",
    format: "json",
    formatversion: "2",
    apfrom: `Biliyor_muydunuz?/${targetDateStr}`
  });

  const listRes = await fetchWithRetry(listUrl, { headers: WIKI_HEADERS });
  const listData = await listRes.json();
  const pages = listData?.query?.allpages || [];

  const candidates = pages
    .map(p => p.title || "")
    .map(title => {
      const m = title.match(/(\d{4})-(\d{2})-(\d{2})$/);
      return m ? { title, date: `${m[1]}-${m[2]}-${m[3]}` } : null;
    })
    .filter(Boolean)
    .filter(x => new Date(x.date).getTime() < cutoff.getTime());

  if (!candidates.length) return "Aday sayfa bulunamadı.";

  const shuffled = candidates.sort(() => 0.5 - Math.random());
  let selected = null;
  let rawWikitext = "";
  let imageUrl = null;

  for (const item of shuffled) {
    if (env.DB) {
      const row = await env.DB.prepare("SELECT page_title FROM sent_facts WHERE page_title = ?")
        .bind(item.title)
        .first();
      if (row) continue;
    }

    const parseUrl = new URL("https://tr.wikipedia.org/w/api.php");
    parseUrl.search = new URLSearchParams({
      action: "parse",
      page: item.title,
      format: "json",
      formatversion: "2",
      prop: "wikitext",
      redirects: "1"
    });

    const parseRes = await fetchWithRetry(parseUrl, { headers: WIKI_HEADERS });
    const parseData = await parseRes.json();
    const content = parseData?.parse?.wikitext || "";

    const imageMatch = content.match(/\[\[(?:Dosya|Resim|File|Media|Image):([^|\]\n]+)/i);
    if (imageMatch && imageMatch[1]) {
      const resolvedUrl = await fetchWikipediaImageUrl(imageMatch[1].trim());
      if (resolvedUrl) {
        selected = item;
        rawWikitext = content;
        imageUrl = resolvedUrl;
        break;
      }
    }
  }

  if (!selected || !imageUrl) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "⚠️ Görselli yeni bir içerik bulunamadı. Lütfen tekrar /hazirla yazın."
      })
    });
    return "Görselli içerik bulunamadı.";
  }

  let cleanText = temizleWikitext(rawWikitext);
  cleanText = cleanText.replace(/^(?:Vikipedi|Biliyor muydu(?:nuz)?\??|Arşiv|Ana sayfa)[^.!?]*[.!?]?\s*/i, "").trim();

  const encodedTitle = encodeURIComponent(selected.title.replace(/ /g, "_"));
  const dynamicSourceUrl = `https://tr.wikipedia.org/wiki/${encodedTitle}`;

  // Instagram Açıklama Taslağı
  const instagramCaption = 
`💡 Bunu biliyor muydunuz?

${cleanText}

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

  const squareParams = new URLSearchParams({ text: cleanText, img: imageUrl, wm: WATERMARK, ratio: "square" });
  const portraitParams = new URLSearchParams({ text: cleanText, img: imageUrl, wm: WATERMARK, ratio: "portrait" });

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "📥 Instagram Kare (1:1)", url: `${origin}/image?${squareParams.toString()}` },
        { text: "📥 Instagram Portre (4:5)", url: `${origin}/image?${portraitParams.toString()}` }
      ]
    ]
  };

  // Telegram'a gönder
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: imageUrl,
      caption: telegramMessage,
      parse_mode: "HTML",
      reply_markup: replyMarkup
    })
  });

  if (env.DB) {
    const factHash = simpleHash(cleanText);
    await env.DB.prepare("INSERT OR IGNORE INTO sent_facts (page_title, fact_hash) VALUES (?, ?)")
      .bind(selected.title, factHash)
      .run();
  }

  return `Başarılı! Gönderildi: ${selected.title}`;
}

// Görsel SVG Render Motoru (Bebas Neue Fontu & Geniş Metin Alanı)
function handleImageGeneration(url) {
  const text = url.searchParams.get("text") || "Bunu biliyor muydunuz?";
  const bgImg = url.searchParams.get("img") || "";
  const watermark = url.searchParams.get("wm") || "@Buguntarihte";
  const ratio = url.searchParams.get("ratio") || "square";

  const width = 1080;
  const height = ratio === "portrait" ? 1350 : 1080;

  // Genişletilmiş karakter sınırı (Daha az satır kaplaması için)
  const maxLineChars = ratio === "portrait" ? 42 : 46;
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

  // Font boyutu 30px, satır yüksekliği 42px (Daha kompakt ve şık)
  const lineHeight = 44;
  const totalTextHeight = lines.length * lineHeight;
  
  const bottomMargin = ratio === "portrait" ? 140 : 110;
  const startY = height - bottomMargin - totalTextHeight;
  const badgeY = startY - 60;

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
          font-size: 34px;
          letter-spacing: 1.5px;
          word-spacing: 2px;
          fill: #ffffff;
        }
        .badge-text {
          font-family: 'Bebas Neue', 'Impact', sans-serif;
          font-size: 24px;
          letter-spacing: 2px;
          fill: #000000;
        }
        .watermark-text {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 20px;
          font-weight: 700;
          letter-spacing: 0.5px;
          fill: #ffffff;
        }
      </style>

      <linearGradient id="bottomGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.05" />
        <stop offset="35%" stop-color="#000000" stop-opacity="0.30" />
        <stop offset="65%" stop-color="#000000" stop-opacity="0.82" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0.96" />
      </linearGradient>

      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.9"/>
      </filter>
    </defs>

    <rect width="${width}" height="${height}" fill="#0a0a0a" />
    ${bgImg ? `<image href="${escapeXml(bgImg)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="0.90" />` : ""}
    <rect width="${width}" height="${height}" fill="url(#bottomGrad)" />

    <!-- Sol Üst Rozet: Instagram İkonu + @Buguntarihte -->
    <g transform="translate(60, 75)">
      <rect x="0" y="0" width="${watermark.length * 15 + 65}" height="48" rx="24" fill="#000000" fill-opacity="0.60" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.5" />
      
      <!-- Instagram SVG Logosu -->
      <g transform="translate(14, 12) scale(0.048)">
        <path fill="#f59e0b" d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z"/>
      </g>

      <text x="46" y="30" class="watermark-text">
        ${escapeXml(watermark)}
      </text>
    </g>

    <!-- BİLİYOR MUYDUNUZ? Rozeti -->
    <g transform="translate(540, ${badgeY})">
      <rect x="-150" y="-26" width="300" height="52" rx="26" fill="#f59e0b" filter="url(#softShadow)" />
      <text text-anchor="middle" y="8" class="badge-text">
        BİLİYOR MUYDUNUZ?
      </text>
    </g>

    <!-- Bilgi Metni (Bebas Neue Fontuyla Geniş ve Estetik) -->
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

// Tüm Formatları (SVG, TIF, PNG, JPG vb.) Yüksek Çözünürlüklü JPEG/PNG Thumbnail Olarak Çeken Fonksiyon
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
    const res = await fetchWithRetry(imgApiUrl, { headers: WIKI_HEADERS });
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
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1")
    .replace(/'{2,3}/g, "")
    .replace(/\b\d{2,4}x\d{2,4}px\b/gi, " ")
    .replace(/^[;*.]+\s*/, "")
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

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}
