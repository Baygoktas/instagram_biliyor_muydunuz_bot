export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runInstagramBot(env));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/image") {
      return handleImageGeneration(url);
    }

    try {
      const result = await runInstagramBot(env, url.origin);
      return new Response(result || "İşlem başarıyla tamamlandı.🧿", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    } catch (err) {
      console.error(err);
      return new Response(`Hata Detayı:\n${err.message}\n\nStack:\n${err.stack}`, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  }
};

const WIKI_HEADERS = {
  "User-Agent": "WikipediaInstagramBot/2.0 (contact: telegramherokuhesabi3@gmail.com)",
  "Api-User-Agent": "WikipediaInstagramBot/2.0 (contact: telegramherokuhesabi3@gmail.com)",
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

async function runInstagramBot(env, origin = "") {
  const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || "7498614075:AAHepFlPgEvvohNwg-BWUrgAW1OrbxEUXeo";
  const TELEGRAM_CHAT_ID = env.TELEGRAM_CHAT_ID || "1283445630";
  const WATERMARK = env.CHANNEL_WATERMARK || "@Tarihtebugun";

  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes("BURAYA_BOT")) {
    throw new Error("TELEGRAM_BOT_TOKEN tanımlanmadı!");
  }
  if (!TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID.includes("BURAYA_OZEL")) {
    throw new Error("TELEGRAM_CHAT_ID tanımlanmadı!");
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
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

  if (!candidates.length) return "Aday arşiv sayfası bulunamadı.";

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

    const imageMatch = content.match(/\[\[(?:Dosya|File|Media):([^|\]]+)/i);
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
    return "Görselli yeni bir arşiv maddesi bulunamadı, bir sonraki çalışmada tekrar denenecek.";
  }

  let cleanText = temizleWikitext(rawWikitext);
  cleanText = cleanText.replace(/^(?:Vikipedi|Biliyor muydu(?:nuz)?\??|Arşiv|Ana sayfa)[^.!?]*[.!?]?\s*/i, "").trim();

  if (!cleanText || cleanText.length < 20) return "Metin yetersiz.";

  const encodedTitle = encodeURIComponent(selected.title.replace(/ /g, "_"));
  const dynamicSourceUrl = `https://tr.wikipedia.org/wiki/${encodedTitle}`;

  const messageText =
    `📸 <b>INSTAGRAM İÇİN HAZIR GÖRSEL TASLAĞI</b>\n\n` +
    `💡 <b>Metin:</b>\n${escapeHtml(cleanText)}\n\n` +
    `🔎 <b>Kaynak:</b> <a href="${dynamicSourceUrl}">Vikipedi</a>\n\n` +
    `👇 <i>Aşağıdaki butonlardan formatı seçip görseli indirebilirsiniz:</i>`;

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

  let sentSuccessfully = false;

  // 1. Önce Fotoğraflı Gönderim Dene
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        photo: imageUrl,
        caption: messageText,
        parse_mode: "HTML",
        reply_markup: replyMarkup
      })
    });
    const photoData = await res.json();
    if (photoData.ok) sentSuccessfully = true;
  } catch (e) {
    console.error("Fotoğraf gönderiminde hata:", e);
  }

  // 2. Telegram URL çekme hatası verirse butonları ve linkleri metin mesajıyla ilet
  if (!sentSuccessfully) {
    const resMsg = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: messageText,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
        disable_web_page_preview: false
      })
    });
    const msgData = await resMsg.json();
    if (!msgData.ok) throw new Error(`Telegram Hatası: ${msgData.description}`);
  }

  if (env.DB) {
    const factHash = simpleHash(cleanText);
    await env.DB.prepare("INSERT OR IGNORE INTO sent_facts (page_title, fact_hash) VALUES (?, ?)")
      .bind(selected.title, factHash)
      .run();
  }

  return `Başarılı! Özel sohbetinize taslak gönderildi: ${selected.title}`;
}

// Görsel Render Motoru
function handleImageGeneration(url) {
  const text = url.searchParams.get("text") || "Bunu biliyor muydunuz?";
  const bgImg = url.searchParams.get("img") || "";
  const watermark = url.searchParams.get("wm") || "@Tarihtebugun";
  const ratio = url.searchParams.get("ratio") || "square";

  const width = 1080;
  const height = ratio === "portrait" ? 1350 : 1080;

  const maxLineChars = ratio === "portrait" ? 30 : 34;
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

  const lineHeight = 54;
  const totalTextHeight = lines.length * lineHeight;
  
  const bottomMargin = ratio === "portrait" ? 160 : 130;
  const startY = height - bottomMargin - totalTextHeight;
  const badgeY = startY - 70;

  const tspanLines = lines
    .map((line, idx) => `<tspan x="540" y="${startY + idx * lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bottomGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.05" />
        <stop offset="40%" stop-color="#000000" stop-opacity="0.25" />
        <stop offset="65%" stop-color="#000000" stop-opacity="0.80" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0.96" />
      </linearGradient>

      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.9"/>
      </filter>
    </defs>

    <rect width="${width}" height="${height}" fill="#0a0a0a" />

    ${bgImg ? `<image href="${escapeXml(bgImg)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="0.90" />` : ""}

    <rect width="${width}" height="${height}" fill="url(#bottomGrad)" />

    <!-- Sol Üst Filigran Rozeti -->
    <g transform="translate(60, 80)">
      <rect x="0" y="0" width="${watermark.length * 16 + 40}" height="46" rx="23" fill="#000000" fill-opacity="0.55" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.5" />
      <circle cx="23" cy="23" r="6" fill="#f59e0b" />
      <text x="38" y="29" fill="#f3f4f6" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Montserrat', Roboto, sans-serif" font-size="20" font-weight="700" letter-spacing="0.5">
        ${escapeXml(watermark)}
      </text>
    </g>

    <!-- BİLİYOR MUYDUNUZ? Rozeti -->
    <g transform="translate(540, ${badgeY})">
      <rect x="-160" y="-30" width="320" height="60" rx="30" fill="#f59e0b" filter="url(#softShadow)" />
      <text text-anchor="middle" y="8" fill="#000000" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Montserrat', sans-serif" font-size="20" font-weight="900" letter-spacing="2.5">
        BİLİYOR MUYDUNUZ?
      </text>
    </g>

    <!-- Bilgi Metni -->
    <text text-anchor="middle" fill="#ffffff" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Montserrat', 'Helvetica Neue', sans-serif" font-size="38" font-weight="700" letter-spacing="0.2" filter="url(#softShadow)">
      ${tspanLines}
    </text>

    <!-- Alt Çizgi -->
    <line x1="440" y1="${height - 50}" x2="640" y2="${height - 50}" stroke="#f59e0b" stroke-width="4" stroke-linecap="round" opacity="0.8" />
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
    const ext = fileName.split(".").pop().toLowerCase();
    if (["svg", "tif", "tiff", "ogg", "ogv", "pdf"].includes(ext)) {
      return null;
    }

    const imgApiUrl = new URL("https://tr.wikipedia.org/w/api.php");
    imgApiUrl.search = new URLSearchParams({
      action: "query",
      titles: `File:${fileName}`,
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
    .replace(/\[\[(?:Dosya|File|Media):[^\]]+\]\]/gi, " ")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1")
    .replace(/'{2,3}/g, "")
    .replace(/\b\d{2,4}x\d{2,4}px\b/gi, " ")
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
