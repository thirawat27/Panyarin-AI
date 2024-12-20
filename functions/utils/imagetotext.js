// นำเข้าไลบรารีที่จำเป็นสำหรับการใช้งาน
import { GoogleGenerativeAI } from "@google/generative-ai";

// สร้างอินสแตนซ์ของ GoogleGenerativeAI โดยใช้ API key
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

class imagetotext {
    constructor() {
        // กำหนดโมเดลที่ใช้สำหรับการสร้างเนื้อหาจาก Google Generative AI
        this.model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-8b" });

        // กำหนดการตั้งค่าความปลอดภัยที่ใช้ในการกรองเนื้อหาที่ไม่เหมาะสม
        this.safetySettings = [
            { category: "HARM_CATEGORY_DEROGATORY", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_VIOLENCE", threshold: "BLOCK_LOW_AND_ABOVE" },
            { category: "HARM_CATEGORY_MEDICAL", threshold: "BLOCK_LOW_AND_ABOVE" },
            { category: "HARM_CATEGORY_DANGEROUS", threshold: "BLOCK_HIGH_ONLY" },
        ];
    }

    // ฟังก์ชันสำหรับการประมวลผลรูปภาพ (Multimodal)
    async multimodal(base64Image) {
        const prompt = "Extract the text from the attached image and summarize the key information in Thai. If the text in the image is in a language other than Thai, translate it to Thai first and then summarize. Please provide an interesting and relevant title for the summary. The summary should be concise, no more than 2-3 paragraphs, and clear using formal language.";
        const mimeType = "image/png";
        const imageParts = [{ inlineData: { data: base64Image, mimeType } }];

        try {
            // เรียกใช้โมเดลเพื่อประมวลผลรูปภาพ
            const result = await this.model.generateContent([prompt, ...imageParts], {
                safetySettings: this.safetySettings,
            });
            return result.response.text(); // คืนค่าผลลัพธ์ที่ได้จากโมเดล
        } catch (error) {
            console.error("Error generating multimodal content:", error); // แสดงข้อผิดพลาดหากเกิดข้อผิดพลาดในการประมวลผล
            throw error;
        }
    }

}

// ส่งออกอินสแตนซ์ของคลาส Gemini
export default new imagetotext();