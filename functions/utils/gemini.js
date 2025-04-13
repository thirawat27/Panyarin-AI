// นำเข้าไลบรารีที่จำเป็นสำหรับการใช้งาน Google Gemini 2.0 API
import { GoogleGenAI } from "@google/genai";
import { extract } from "@extractus/article-extractor";

// สร้างอินสแตนซ์ของ GoogleGenAI โดยใช้ API key
// (ในที่นี้ใช้ process.env.API_KEY สำหรับรักษาความปลอดภัย)
class Gemini {
  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // กำหนดการตั้งค่าความปลอดภัยสำหรับการกรองเนื้อหาที่ไม่เหมาะสม
    this.safetySettings = [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_LOW_AND_ABOVE" }
    ];

    // กำหนดพารามิเตอร์สำหรับโมเดล
    this.parameters = {
      temperature: 0.3,
      top_p: 0.4,
      top_k: 60,
      maxOutputTokens: 1500,
    };
  }

  // ฟังก์ชันสำหรับแสดงเวลาปัจจุบันในรูปแบบภาษาไทย
  getCurrentTime() {
    const now = new Date();
    const dateOptions = {
      timeZone: "Asia/Bangkok",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    };
    const timeOptions = {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };

    const dateString = now.toLocaleDateString("th-TH", dateOptions);
    const timeString = now.toLocaleTimeString("th-TH", timeOptions);

    return `${dateString} เวลา ${timeString} น.`; 
  }

  // ฟังก์ชันสำหรับสร้างเนื้อหาจากข้อความ
  async textOnly(text) {
    let prompt;

    if (text.length >= 1000) {
      // หากข้อความยาว ให้สร้างสรุป
      prompt = `Summarize key information in Thai. Make sure the summary has interesting and relevant topics. The summary should be concise, no more than 1 to 2 paragraphs, and clear using formal language: ${text}`;
    } else {
      prompt = `Assume the role of a female artificial intelligence named "ปัญญาริน" (Panyarin). Respond to all user messages in natural and elegant Thai.
**เงื่อนไขเพิ่มเติม:**
- หากผู้ใช้ถามเกี่ยวกับวันที่หรือเวลา **เท่านั้น** ให้แจ้งข้อมูลปัจจุบันจาก [เวลาปัจจุบัน: ${this.getCurrentTime()}] พร้อมระบุวัน/เดือน/ปีและเวลาชัดเจน (เช่น "วันอังคารที่ 27 กุมภาพันธ์ พ.ศ. 2550 เวลา 15:30 น.")
- เมื่อตอบคำถามเกี่ยวกับอุณหภูมิ ระบุความแตกต่างระหว่างเซลเซียสและฟาเรนไฮต์ (ถ้าจำเป็น)
- ปรับน้ำเสียงและคำศัพท์ให้เหมาะกับบริบทการสนทนา 😊
- ใช้ emojis ✨ เพื่อเพิ่มอารมณ์และความสวยงามให้คำตอบตามความเหมาะสม 🎉
User Input: ${text}`;
    }

    try {
      // เรียกใช้โมเดลเพื่อสร้างเนื้อหาจาก prompt
      const response = await this.ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [prompt],
        config: {
          // เปลี่ยน key จาก googleSearchRetrieval เป็น googleSearch
          tools: [
            {
              googleSearch: {
                // หากต้องการกำหนด dynamicThreshold ให้ระบุไว้ในนี้
                dynamicThreshold: 0.45,
              },
            },
          ],
          safetySettings: this.safetySettings,
          // สามารถรวมพารามิเตอร์โมเดล (temperature, top_p, top_k, maxOutputTokens) เข้าไปใน config ได้ตามต้องการ
          ...this.parameters,
        },
      });
      return response.text;
    } catch (error) {
      console.error("Error generating text:", error);
      throw error;
    }
  }

  // ฟังก์ชันสำหรับดึงข้อมูลจาก URL และสรุปเนื้อหาที่ได้
  async urlToText(url) {
    let content;

    try {
      // ดึงเนื้อหาจาก URL ด้วยไลบรารี extractus
      const response = await extract(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          Referer: "https://www.google.com",
        },
      });
      content = response?.content || "ไม่พบเนื้อหาที่ต้องการจาก URL";
    } catch (error) {
      console.error("Error extracting content from URL:", error.message);
      throw new Error(`ไม่สามารถดึงข้อมูลจาก URL: ${error.message}`);
    }

    const prompt = `Extract and summarize essential details from the following content or URL into 2 or 3 paragraphs with a concise title reflecting the main idea. Respond in Thai using formal language: ${content}`;

    try {
      // เรียกใช้โมเดลเพื่อสร้างเนื้อหาจาก prompt ที่ได้จาก URL
      const response = await this.ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [prompt],
        config: {
          tools: [
            {
              googleSearch: {
                dynamicThreshold: 0.45,
              },
            },
          ],
          safetySettings: this.safetySettings,
          ...this.parameters,
        },
      });
      return response.text;
    } catch (error) {
      console.error("Error generating text from URL content:", error);
      throw new Error(`ไม่สามารถสร้างข้อความจากเนื้อหาที่ดึงมา: ${error.message}`);
    }
  }
}

// ส่งออกอินสแตนซ์ของคลาส Gemini
export default new Gemini();