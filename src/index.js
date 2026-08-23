export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });

    // 1. Instagram Görselini Üreten SVG Motoru
    if (url.pathname === "/image") {
      return handleImageGeneration(url);
    }

    // 2. Webhook Kurulumu (/set-webhook)
    if (url.pathname === "/set-webhook") 
      const token = env.TELEGRAM_BOT_TOKEN || "7498614075:AAHepFlPgEvvohNwg-BWUrgAW1OrbxEUXeo";
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 3. Telegram Webhook Gelen Komutlar
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
      const chatId = env.TELEGRAM_CHAT_ID || "1283445630";
      const result = await generateAndSendPost(env, chatId, url.origin);
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
  "User-Agent": "WikipediaInstagramBot/9.0 (contact: telegramherokuhesabi3@gmail.com)",
  "Accept": "application/json"
};

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
];

async function generateAndSendPost(env, chatId, origin) {
  const token = env.TELEGRAM_BOT_TOKEN || "BURAYA_BOT_TOKENINIZ";
  const watermark = env.CHANNEL_WATERMARK || "@Tarihtebugun";

  if (!token || token.includes("BURAYA_BOT")) {
    throw new Error("TELEGRAM_BOT_TOKEN girilmemiş! Lütfen koddaki BURAYA_BOT_TOKENINIZ alanını doldurun.");
  }
  if (!chatId || chatId.includes("BURAYA_OZEL")) {
    throw new Error("TELEGRAM_CHAT_ID girilmemiş! Lütfen koddaki BURAYA_OZEL_TELEGRAM_CHAT_ID alanını doldurun.");
  }

  // Rastgele bir Ay ve Yıl arşivi seç (2015 - 2024 arası)
  const randomYil = Math.floor(Math.random() * (2024 - 2016 + 1)) + 2016;
  const randomAy = AYLAR[Math.floor(Math.random() * AYLAR.length)];
  const pageTitle = `Vikipedi:Biliyor muydunuz/${randomAy} ${randomYil}`;

  let selectedFact = null;

  try {
    const parseUrl = new URL("https://tr.wikipedia.org/w/api.php");
    parseUrl.search = new URLSearchParams({
      action: "parse",
      page: pageTitle,
      format: "json",
      formatversion: "2",
      prop: "wikitext",
      redirects: "1"
    });

    const res = await fetch(parseUrl, { headers: WIKI_HEADERS });
    const data = await res.json();
    const wikitext = data?.parse?.wikitext || "";

    if (wikitext) {
      // Satırları ayrıştır (* veya ; ile başlayanlar)
      const lines = wikitext.split("\n").filter(l => l.trim().startsWith("*") || l.trim().startsWith(";"));
      const shuffledLines = lines.sort(() => 0.5 - Math.random());

      for (const line of shuffledLines) {
        // Görsel var mı?
        const imgMatch = line.match(/\[\[(?:Dosya|Resim|File|Image):([^|\]\n]+)/i);
        if (imgMatch && imgMatch[1]) {
          const fileName = imgMatch[1].trim();
          const imgUrl = await fetchWikipediaImageUrl(fileName);
          if (imgUrl) {
            const cleanText = temizleWikitext(line);
            if (cleanText.length > 25) {
              selectedFact = {
                title: pageTitle,
                text: cleanText,
                imageUrl: imgUrl
              };
              break;
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Wikipedia ayrıştırma hatası:", e);
  }

  // Sayfada görsel bulunamazsa yedek tarihi görsel ve bilgi havuzu
  if (!selectedFact) {
    selectedFact = {
      title: "Vikipedi:Biliyor muydunuz",
      text: "Mimar Sinan'ın 'Ustalık Eserim' dediği Edirne'deki Selimiye Camii, 2011 yılında UNESCO Dünya Mirası Listesi'ne dahil edilmiştir.",
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Edirne_Selimiye_Mosque_Dome.jpg/1024px-Edirne_Selimiye_Mosque_Dome.jpg"
    };
  }

  const encodedTitle = encodeURIComponent(selectedFact.title.replace(/ /g, "_"));
  const dynamicSourceUrl = `https://tr.wikipedia.org/wiki/${encodedTitle}`;

  // Instagram Açıklaması
  const instagramCaption = 
`💡 Bunu biliyor muydunuz?

${selectedFact.text}

📌 Daha fazla ilginç ve tarihi bilgi için takipte kalın!
.
.
#tarih #tarihtebugun #bunubiliyormuydunuz #bilgi #genelkültür #tarihieser #tariharsivi`;

  const squareUrl = `${origin}/image?text=${encodeURIComponent(selectedFact.text)}&img=${encodeURIComponent(selectedFact.imageUrl)}&wm=${encodeURIComponent(watermark)}&ratio=square`;
  const portraitUrl = `${origin}/image?text=${encodeURIComponent(selectedFact.text)}&img=${encodeURIComponent(selectedFact.imageUrl)}&wm=${encodeURIComponent(watermark)}&ratio=portrait`;

  const telegramMessage =
`✨ <b>YENİ İNSTAGRAM İÇERİĞİNİZ HAZIR!</b>

📝 <b>Instagram Açıklaması (Kopyalamak için tıklayın):</b>
<code>${escapeHtml(instagramCaption)}</code>

🔗 <b>Kaynak:</b> <a href="${dynamicSourceUrl}">Vikipedi</a>

📥 <b>Hazırlanan Instagram Görselleri:</b>
▪️ <a href="${squareUrl}">Kare Görseli İndir (1:1)</a>
▪️ <a href="${portraitUrl}">Portre Görseli İndir (4:5)</a>`;

  // Telegram'a Fotoğraflı Gönderim
  const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: selectedFact.imageUrl,
      caption: telegramMessage,
      parse_mode: "HTML"
    })
  });

  const tgData = await tgRes.json();
  if (!tgData.ok) {
    throw new Error(`Telegram Hatası: ${tgData.description}`);
  }

  return `Başarılı! Telegram'a gönderildi (${selectedFact.title})`;
}

// Görsel Render Motoru (Gelişmiş SVG Tasarımı)
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

    <!-- Sol Üst Filigran -->
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
    .replace(/^[;*]\s*/, "")
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
