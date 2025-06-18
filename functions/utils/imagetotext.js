// นำเข้าไลบรารีที่จำเป็นสำหรับการใช้งาน Google Gemini 2.0 API
import { GoogleGenAI } from "@google/genai";

class ImageToText {
  constructor() {
    // สร้างอินสแตนซ์ของ GoogleGenAI โดยใช้ API Key
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // กำหนดการตั้งค่าความปลอดภัยสำหรับการกรองเนื้อหาที่ไม่เหมาะสม
    this.safetySettings = [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_LOW_AND_ABOVE" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_LOW_AND_ABOVE" },
        { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_LOW_AND_ABOVE" }
      ];
  }

  // ฟังก์ชันสำหรับประมวลผลรูปภาพ (Multimodal)
  async multimodal(base64Image) {
    // กำหนด prompt สำหรับให้โมเดลอ่านและสรุปข้อความจากภาพ
    const prompt =
      "Extract the text from the attached image and summarize the key information in Thai. If the text in the image is in a language other than Thai, first translate it into Thai before summarizing. Provide an engaging and relevant title that aligns with the content. The summary should be concise (no more than 2-3 paragraphs), use formal and clear language, avoid unnecessary interpretation, and retain all essential details.";
    const mimeType = "image/png";

    try {
      // เรียกใช้โมเดลเพื่อประมวลผลรูปภาพและสร้างเนื้อหาจาก prompt พร้อมแนบข้อมูลรูปภาพ (inlineData)
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          prompt,
          { inlineData: { data: base64Image, mimeType } },
        ],
        config: {
          safetySettings: this.safetySettings,
        },
      });
      return response.text;
    } catch (error) {
      console.error("Error generating multimodal content:", error);
      throw error;
    }
  }
}

// ส่งออกอินสแตนซ์ของคลาส ImageToText
export default new ImageToText();
