const TELEGRAM_BOT_TOKEN = "7498614075:AAHepFlPgEvvohNwg-BWUrgAW1OrbxEUXeo";
const AUTHORIZED_CHAT_ID = "1283445630";
const WATERMARK = "@Tarihtebugun";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });

    // Görsel Üretim
    if (url.pathname === "/image") {
      return handleImageGeneration(url);
    }

    // Webhook Kurulumu (/set-webhook)
    if (url.pathname === "/set-webhook") {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Webhook Mesaj Alıcı
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

    // Manuel Web Tetikleme
    try {
      const result = await generateAndSendPost(env, AUTHORIZED_CHAT_ID, url.origin);
      return new Response(result || "İşlem tamamlandı.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    } catch (err) {
      return new Response(`Hata:\n${err.message}`, { status: 500 });
    }
  }
};

const WIKI_HEADERS = {
  "User-Agent": "WikipediaInstagramBot/5.0 (contact: telegramherokuhesabi3@gmail.com)",
  "Api-User-Agent": "WikipediaInstagramBot/5.0 (contact: telegramherokuhesabi3@gmail.com)",
  "Accept": "application/json"
};

async function generateAndSendPost(env, chatId, origin) {
  // 1. "Vikipedi:Biliyor muydunuz" alt sayfalarını doğrudan Kategori veya Prefix ile çek
  const listUrl = new URL("https://tr.wikipedia.org/w/api.php");
  listUrl.search = new URLSearchParams({
    action: "query",
    generator: "allpages",
    gapnamespace: "4",
    gapprefix: "Biliyor muydunuz",
    gaplimit: "500",
    prop: "images|revisions",
    rvprop: "content",
    rvslots: "main",
    format: "json",
    formatversion: "2"
  });

  const listRes = await fetch(listUrl, { headers: WIKI_HEADERS });
  const listData = await listRes.json();
  const pages = listData?.query?.pages || [];

  if (!pages.length) {
    throw new Error("Wikipedia sayfalarına ulaşılamadı.");
  }

  // Havuzu karıştır
  const candidates = pages.sort(() => 0.5 - Math.random());
  let selectedFact = null;

  for (const page of candidates) {
    const rawContent = page?.revisions?.[0]?.slots?.main?.content || "";
    const pageTitle = page.title || "";

    if (!rawContent || pageTitle.endsWith("/Arşiv") || pageTitle === "Vikipedi:Biliyor muydunuz") {
      continue;
    }

    // Madde içindeki resim adını yakala
    let fileName = null;
    const fileMatch = rawContent.match(/\[\[(?:Dosya|Resim|File|Image):([^|\]\n]+)/i);
    if (fileMatch && fileMatch[1]) {
      fileName = fileMatch[1].trim();
    } else if (page.images && page.images.length > 0) {
      const validImg = page.images.find(img => {
        const title = img.title.toLowerCase();
        return !title.endsWith(".svg") && !title.includes("icon") && !title.includes("logo");
      });
      if (validImg) fileName = validImg.title;
    }

    if (!fileName) continue;

    // Görsel URL'ini çöz
    const resolvedUrl = await fetchWikipediaImageUrl(fileName);
    if (!resolvedUrl) continue;

    // Metni ayıkla
    let cleanText = temizleWikitext(rawContent);
    cleanText = cleanText.replace(/^(?:Vikipedi|Biliyor muydu(?:nuz)?\??|Arşiv|Ana sayfa)[^.!?]*[.!?]?\s*/i, "").trim();

    // Çoklu madde varsa ilk cümleyi / maddeyi al
    if (cleanText.includes("...")) {
      const parts = cleanText.split("...");
      const validPart = parts.find(p => p.trim().length > 30);
      if (validPart) cleanText = validPart.trim();
    }

    if (cleanText && cleanText.length > 25 && cleanText.length < 500) {
      const factHash = simpleHash(cleanText);

      // D1 kontrolü
      if (env.DB) {
        const row = await env.DB.prepare("SELECT page_title FROM sent_facts WHERE fact_hash = ?")
          .bind(factHash)
          .first();
        if (row) continue;
      }

      selectedFact = {
        title: pageTitle,
        text: cleanText,
        imageUrl: resolvedUrl,
        hash: factHash
      };
      break;
    }
  }

  if (!selectedFact) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "⚠️ Arşiv taranıyor, lütfen 1 saniye sonra tekrar /hazirla yazın."
      })
    });
    return "Tekrar deneyin.";
  }

  const encodedTitle = encodeURIComponent(selectedFact.title.replace(/ /g, "_"));
  const dynamicSourceUrl = `https://tr.wikipedia.org/wiki/${encodedTitle}`;

  // Instagram Açıklama Taslağı
  const instagramCaption = 
`💡 Bunu biliyor muydunuz?

${selectedFact.text}

📌 Daha fazla ilginç ve tarihi bilgi için takipte kalın!
.
.
#tarih #tarihtebugun #bunubiliyormuydunuz #bilgi #genelkültür #tarihieser #tariharsivi`;

  const telegramCaptionText =
`✨ <b>YENİ İNSTAGRAM İÇERİĞİNİZ HAZIR!</b>

📝 <b>Instagram Açıklaması (Kopyalamak için tıklayın):</b>
<code>${escapeHtml(instagramCaption)}</code>

🔗 <b>Kaynak:</b> <a href="${dynamicSourceUrl}">Vikipedi</a>`;

  const squareUrl = `${origin}/image?text=${encodeURIComponent(selectedFact.text)}&img=${encodeURIComponent(selectedFact.imageUrl)}&wm=${encodeURIComponent(WATERMARK)}&ratio=square`;
  const portraitUrl = `${origin}/image?text=${encodeURIComponent(selectedFact.text)}&img=${encodeURIComponent(selectedFact.imageUrl)}&wm=${encodeURIComponent(WATERMARK)}&ratio=portrait`;

  // 2 Görseli Albüm Halinde Gönder
  const albumRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMediaGroup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      media: [
        {
          type: "photo",
          media: squareUrl,
          caption: telegramCaptionText,
          parse_mode: "HTML"
        },
        {
          type: "photo",
          media: portraitUrl
        }
      ]
    })
  });

  const albumData = await albumRes.json();

  // Telegram uzaktan SVG URL'i albüm olarak almazsa Document olarak ilet
  if (!albumData.ok) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        document: squareUrl,
        caption: "🖼 <b>Instagram Kare (1:1)</b>\n\n" + telegramCaptionText,
        parse_mode: "HTML"
      })
    });

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        document: portraitUrl,
        caption: "🖼 <b>Instagram Portre (4:5)</b>",
        parse_mode: "HTML"
      })
    });
  }

  if (env.DB) {
    await env.DB.prepare("INSERT OR IGNORE INTO sent_facts (page_title, fact_hash) VALUES (?, ?)")
      .bind(selectedFact.title, selectedFact.hash)
      .run();
  }

  return `Başarılı! Gönderildi: ${selectedFact.title}`;
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
    const cleanName = fileName.replace(/^(?:Dosya|Resim|File|Image):/i, "").trim();
    const ext = cleanName.split(".").pop().toLowerCase();
    if (["svg", "tif", "tiff", "ogg", "ogv", "pdf"].includes(ext)) return null;

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
    .replace(/\[\[(?:Dosya|Resim|File|Media):[^\]]+\]\]/gi, " ")
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
