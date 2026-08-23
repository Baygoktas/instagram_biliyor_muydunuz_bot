const BOT_TOKEN = "7498614075:AAHepFlPgEvvohNwg-BWUrgAW1OrbxEUXeo";
const MY_CHAT_ID = "1283445630";
const WATERMARK = "@biliyormuydunuz";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });

    // 1. Doğrudan PNG Üreten ve İndiren Sayfa
    if (url.pathname === "/view") {
      return handleCanvasView(url);
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
  "User-Agent": "WikipediaInstagramBot/3.0 (contact: telegramherokuhesabi3@gmail.com)",
  "Accept": "application/json"
};

async function generateAndSendPost(env, chatId, origin) {
  if (env.DB) {
    try {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS sent_facts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          page_title TEXT UNIQUE,
          fact_hash TEXT UNIQUE,
          sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    } catch (e) {}
  }

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
    if (env.DB) {
      try {
        const row = await env.DB.prepare("SELECT page_title FROM sent_facts WHERE page_title = ?")
          .bind(page.title)
          .first();
        if (row) continue;
      } catch (e) {}
    }

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
          const factHash = simpleHash(cleanText);

          if (env.DB) {
            try {
              const rowHash = await env.DB.prepare("SELECT fact_hash FROM sent_facts WHERE fact_hash = ?")
                .bind(factHash)
                .first();
              if (rowHash) continue;
            } catch (e) {}
          }

          selectedFact = {
            title: page.title,
            text: cleanText,
            imageUrl: imgUrl,
            hash: factHash
          };
          break;
        }
      }
    }
  }

  if (!selectedFact) {
    selectedFact = {
      title: "Vikipedi:Biliyor muydunuz/" + Date.now(),
      text: "Osmanlı padişahı III. Osman sarayda dolaşırken cariyelerle karşılaşmak istemediği için ayakkabılarına demir ökçeler taktırmıştı.",
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Osman_III.jpg/1200px-Osman_III.jpg",
      hash: simpleHash("Osmanlı padişahı III. Osman demir ökçeler")
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

👇 <i>Aşağıdaki butonlardan formatı seçip görseli doğrudan galerinize indirin:</i>`;

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
  } catch (e) {}

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

  if (env.DB) {
    try {
      await env.DB.prepare("INSERT OR IGNORE INTO sent_facts (page_title, fact_hash) VALUES (?, ?)")
        .bind(selectedFact.title, selectedFact.hash)
        .run();
    } catch (e) {}
  }

  return `Gönderildi: ${selectedFact.title}`;
}

// Güvenli HTML5 Canvas Render Sayfası
function handleCanvasView(url) {
  const text = url.searchParams.get("text") || "Tarihin tozlu raflarında kalmış ilginç ve bilinmeyen detaylar.";
  const bgImg = url.searchParams.get("img") || "";
  const ratio = url.searchParams.get("ratio") || "square";

  const width = 1080;
  const height = ratio === "portrait" ? 1350 : 1080;

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Görseli İndir</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, sans-serif; }
    body { background: #0b0f19; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
    .wrap { max-width: 480px; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 16px; }
    .canvas-box { width: 100%; border-radius: 12px; overflow: hidden; box-shadow: 0 12px 36px rgba(0,0,0,0.8); background: #000; }
    canvas { width: 100%; height: auto; display: block; }
    .btn { width: 100%; padding: 16px; font-size: 16px; font-weight: 700; color: #000; background: #f59e0b; border: none; border-radius: 10px; cursor: pointer; display: block; text-align: center; text-decoration: none; box-shadow: 0 4px 16px rgba(245, 158, 11, 0.4); }
    .btn:active { transform: scale(0.98); }
    .tip { font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="canvas-box">
      <canvas id="c" width="${width}" height="${height}"></canvas>
    </div>
    <a class="btn" id="dl" href="#" download="instagram_post.png">📥 Galeriye Kaydet (PNG)</a>
    <p class="tip">Görselin üzerine basılı tutarak da cihazınıza kaydedebilirsiniz.</p>
  </div>

  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const dlBtn = document.getElementById('dl');

    const width = ${width};
    const height = ${height};
    const text = ${JSON.stringify(text.toLocaleUpperCase("tr-TR"))};
    const watermark = ${JSON.stringify(WATERMARK)};
    const bgUrl = ${JSON.stringify(bgImg)};

    async function draw() {
      // 1. Siyah Zemin
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, width, height);

      // 2. Arka Plan Resmi
      if (bgUrl) {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = resolve; // Hata alsa da akışı kesmez
            img.src = bgUrl;
          });
          if (img.width) {
            const hRatio = width / img.width;
            const vRatio = height / img.height;
            const ratio = Math.max(hRatio, vRatio);
            const centerShiftX = (width - img.width * ratio) / 2;
            const centerShiftY = (height - img.height * ratio) / 2;
            ctx.globalAlpha = 0.95;
            ctx.drawImage(img, 0, 0, img.width, img.height, centerShiftX, centerShiftY, img.width * ratio, img.height * ratio);
            ctx.globalAlpha = 1.0;
          }
        } catch(e){}
      }

      // 3. Yazı Alanı Degrade Karartması
      const grad = ctx.createLinearGradient(0, height * 0.35, 0, height);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.4, 'rgba(0,0,0,0.3)');
      grad.addColorStop(0.7, 'rgba(0,0,0,0.85)');
      grad.addColorStop(0.95, 'rgba(0,0,0,0.98)');
      grad.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // 4. Sol Üst Rozet (@biliyormuydunuz)
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      // Instagram çerçeve
      roundRect(ctx, 60, 60, 44, 44, 12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(82, 82, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(92, 72, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Rozet Metni
      ctx.font = '700 22px Inter, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(watermark, 116, 89);

      // 5. Metin Satırlama
      ctx.font = '34px "Bebas Neue", Impact, sans-serif';
      const words = text.split(' ');
      const lines = [];
      let cur = '';
      const maxChars = ${ratio === "portrait" ? 44 : 48};

      for (const w of words) {
        if ((cur + ' ' + w).trim().length > maxChars) {
          if (cur) lines.push(cur.trim());
          cur = w;
        } else {
          cur += ' ' + w;
        }
      }
      if (cur) lines.push(cur.trim());

      const lineHeight = 46;
      const totalH = lines.length * lineHeight;
      const bottomM = ${ratio === "portrait" ? 140 : 110};
      const startY = height - bottomM - totalH;
      const titleY = startY - 70;

      // 6. Başlık (BİLİYOR MUYDUNUZ?)
      ctx.font = '56px "Bebas Neue", Impact, sans-serif';
      ctx.fillStyle = '#f59e0b';
      ctx.textAlign = 'center';
      ctx.fillText('BİLİYOR MUYDUNUZ?', width / 2, titleY);

      // Sarı Çizgi
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(width / 2 - 50, titleY + 20);
      ctx.lineTo(width / 2 + 50, titleY + 20);
      ctx.stroke();

      // 7. Gövde Metni
      ctx.font = '34px "Bebas Neue", Impact, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 8;
      lines.forEach((l, i) => {
        ctx.fillText(l, width / 2, startY + i * lineHeight);
      });
      ctx.shadowBlur = 0;

      // 8. Alt İkonlar
      drawIcons(ctx, width, height);

      // İndirme Butonunu Bağla
      try {
        dlBtn.href = canvas.toDataURL('image/png');
      } catch(e){}
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    function drawIcons(ctx, w, h) {
      const baseY = h - 60;
      const startX = w / 2 - 180;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1. Kaydet
      ctx.beginPath();
      ctx.moveTo(startX, baseY);
      ctx.lineTo(startX + 18, baseY);
      ctx.lineTo(startX + 18, baseY + 24);
      ctx.lineTo(startX + 9, baseY + 18);
      ctx.lineTo(startX, baseY + 24);
      ctx.closePath();
      ctx.stroke();

      // 2. Kalp
      const kX = startX + 110;
      ctx.beginPath();
      ctx.arc(kX + 6, baseY + 6, 6, Math.PI, 0, false);
      ctx.arc(kX + 16, baseY + 6, 6, Math.PI, 0, false);
      ctx.lineTo(kX + 11, baseY + 22);
      ctx.closePath();
      ctx.stroke();

      // 3. Yorum
      const yX = startX + 220;
      roundRect(ctx, yX, baseY, 22, 16, 5);
      ctx.stroke();

      // 4. Paylaş (Uçak)
      const pX = startX + 330;
      ctx.beginPath();
      ctx.moveTo(pX + 22, baseY);
      ctx.lineTo(pX, baseY + 10);
      ctx.lineTo(pX + 8, baseY + 13);
      ctx.lineTo(pX + 22, baseY);
      ctx.stroke();
    }

    // Fontlar yüklenince çizimi başlat
    document.fonts.ready.then(draw);
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
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

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}
