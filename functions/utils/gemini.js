// นำเข้าไลบรารีที่จำเป็นสำหรับการใช้งาน
import { GoogleGenerativeAI, DynamicRetrievalMode } from "@google/generative-ai";
import { extract } from "@extractus/article-extractor";

// สร้างอินสแตนซ์ของ GoogleGenerativeAI โดยใช้ API key
const genAI = new GoogleGenerativeAI(process.env.API_KEY);


class Gemini {
  constructor() {
    // กำหนดโมเดลที่ใช้สำหรับการสร้างเนื้อหาจาก Google Generative AI
    this.model = genAI.getGenerativeModel(
      {
        model: "gemini-1.5-flash-8b",
        tools: [
          {
            googleSearchRetrieval: {
              dynamicRetrievalConfig: {
                mode: DynamicRetrievalMode.MODE_DYNAMIC,
                dynamicThreshold: 0.5,
              },
            },
          },
        ],
      },
      { apiVersion: "v1beta" },
    );

    // กำหนดการตั้งค่าความปลอดภัยที่ใช้ในการกรองเนื้อหาที่ไม่เหมาะสม
    this.safetySettings = [
      { category: "HARM_CATEGORY_DEROGATORY", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_VIOLENCE", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_MEDICAL", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS", threshold: "BLOCK_HIGH_ONLY" },
    ];

     // กำหนด parameters ที่ใช้ปรับแต่งการทำงานของโมเดล
     this.parameters = {
      temperature: 0.3,
      top_p: 0.8,
      top_k: 40,
      maxOutputTokens: 1000,
    };
  }

  // ฟังก์ชันสำหรับการสร้างเนื้อหาจากข้อความ
  async textOnly(text) {
    let prompt;

    // ถ้าข้อความมีความยาวมากกว่า 200 ตัวอักษร ให้สร้างข้อความสรุป
    if (text.length >= 1000) {
      prompt = `Summarize key information in Thai. Make sure the summary has interesting and relevant topics. The summary should be concise, no more than 1 to 2 paragraphs, and clear using formal language.": ${text}`;
    } else {
      // ถ้าข้อความสั้นกว่า 200 ตัวอักษร ให้ใช้ข้อความนั้นๆ
      prompt = `Assume the role of a female artificial intelligence. Respond to all user messages in natural and elegant Thai. Introduce yourself as an AI named "ปัญญาริน" (Panyarin) when appropriate. When answering questions about temperature, provide clarity between Celsius and Fahrenheit if needed. Choose a tone of voice and vocabulary that is appropriate to the context of the conversation. 😊 Feel free to use emojis ✨ to add emotion and flair to your responses as you see fit 🎉,User Input : ${text}`;
    }

    try {
      // เรียกใช้โมเดลเพื่อสร้างเนื้อหาจากข้อความ
      const result = await this.model.generateContent(prompt, {
        safetySettings: this.safetySettings,
        parameters: this.parameters, 
      });
      return result.response.text(); // คืนค่าผลลัพธ์ที่ได้จากโมเดล
    } catch (error) {
      console.error("Error generating text:", error); // แสดงข้อผิดพลาดหากเกิดข้อผิดพลาดในการสร้างข้อความ
      throw error;
    }
  }

  // ฟังก์ชันสำหรับดึงข้อมูลจาก URL และสรุปเนื้อหาที่ได้
  async urlToText(url) {
    let content;

    try {
      // ใช้ไลบรารี @extractus/article-extractor ดึงเนื้อหาจาก URL
      const response = await extract(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Referer": "https://www.google.com"
        }
      });
      content = response?.content || "ไม่พบเนื้อหาที่ต้องการจาก URL"; // กำหนดค่าเริ่มต้นเมื่อไม่สามารถดึงเนื้อหาได้
    } catch (error) {
      console.error("Error extracting content from URL:", error.message); // แสดงข้อผิดพลาดหากไม่สามารถดึงข้อมูลจาก URL ได้
      throw new Error(`ไม่สามารถดึงข้อมูลจาก URL: ${error.message}`);
    }

    // สร้าง prompt สำหรับสรุปเนื้อหาจาก URL
    const prompt = `Extract and summarize essential details from the following content or URL into 2 or 3 paragraphs with a concise title reflecting the main idea. Respond in Thai using formal language : ${content}`;

    try {
      // เรียกใช้โมเดลเพื่อสร้างเนื้อหาจาก URL
      const result = await this.model.generateContent(prompt, {
        safetySettings: this.safetySettings,
        parameters: this.parameters, 
      });
      return result.response.text(); // คืนค่าผลลัพธ์ที่ได้จากโมเดล
    } catch (error) {
      console.error("Error generating text from URL content:", error); // แสดงข้อผิดพลาดหากไม่สามารถสร้างข้อความจากเนื้อหาจาก URL ได้
      throw new Error(`ไม่สามารถสร้างข้อความจากเนื้อหาที่ดึงมา: ${error.message}`);
    }
  }
}

// ส่งออกอินสแตนซ์ของคลาส Gemini
export default new Gemini();