// นำเข้าไลบรารี axios สำหรับการทำ HTTP requests
import axios from "axios";

// กำหนด header สำหรับการเรียกใช้งาน API ของ LINE
const LINE_HEADER = {
  "Content-Type": "application/json", // ระบุประเภทของข้อมูลเป็น JSON
  Authorization: `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}`, // ใส่ Access Token สำหรับการเข้าถึง API
};

// สร้างคลาส LINE เพื่อจัดการฟังก์ชันต่างๆ ที่เกี่ยวข้องกับ LINE API
class LINE {
  // ฟังก์ชันสำหรับดึงข้อมูลภาพในรูปแบบ Binary จาก messageId
  async getImageBinary(messageId) {
    // ทำการเรียก API เพื่อดึงข้อมูลภาพโดยใช้ messageId
    const originalImage = await axios({
      method: "get", // กำหนดวิธีการเรียก GET
      headers: LINE_HEADER, // ใส่ headers ที่กำหนดไว้
      url: `https://api-data.line.me/v2/bot/message/${messageId}/content`, // URL สำหรับเรียกข้อมูลภาพ
      responseType: "arraybuffer", // กำหนดประเภทของข้อมูลที่ตอบกลับเป็น ArrayBuffer
    });
    return originalImage.data; // ส่งกลับข้อมูลภาพที่ได้รับ
  }
    // ฟังก์ชันสำหรับดึงข้อมูลเสียงในรูปแบบ Binary จาก messageId
  async getAudio(messageId) {
    try {
      // ตรวจสอบ messageId ก่อนสร้าง URL
      if (!messageId || typeof messageId !== 'string' || messageId.trim() === '') {
        console.error("Invalid messageId:", messageId);
        throw new Error("Invalid messageId"); // throw error เพื่อให้ handleAudioMessage จัดการ
      }

      const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
      console.log("URL for getAudio:", url); // แสดง URL ใน console เพื่อ debug

      // ทำการเรียก API เพื่อดึงข้อมูลเสียงโดยใช้ messageId
      const originalAudio = await axios({
        method: "get", // กำหนดวิธีการเรียก GET
        headers: LINE_HEADER, // ใส่ headers ที่กำหนดไว้
        url: url, // URL สำหรับเรียกข้อมูลเสียง
        responseType: "arraybuffer", // กำหนดประเภทของข้อมูลที่ตอบกลับเป็น ArrayBuffer
      });
      return originalAudio.data; // ส่งกลับข้อมูลเสียงที่ได้รับ

    } catch (error) {
      console.error("Error getting audio:", error); // แสดง error message ใน console
      throw error; // ส่งต่อ error เพื่อให้ handleAudioMessage จัดการ
    }
  }
  
  // ฟังก์ชันสำหรับตอบกลับข้อความไปยังผู้ใช้
  reply(token, payload, quickReply = null) {  // เพิ่ม parameter quickReply สำหรับ quick reply
    // สร้าง message object
    const message = {
      replyToken: token,
      messages: payload,
    };

    // เพิ่ม quickReply object ถ้ามี
    if (quickReply) {
      message.messages[0].quickReply = quickReply;
    }

    // ทำการเรียก API เพื่อตอบกลับข้อความ
    return axios({
      method: "post", // กำหนดวิธีการเรียก POST
      url: "https://api.line.me/v2/bot/message/reply", // URL สำหรับการตอบกลับข้อความ
      headers: LINE_HEADER, // ใส่ headers ที่กำหนดไว้
      data: message, // ส่ง message object ที่สร้างขึ้น
    });
  }

  // ฟังก์ชันสำหรับเริ่มการโหลด
  loading(userId) {
    // ทำการเรียก API เพื่อเริ่มการโหลด
    return axios({
      method: "post", // กำหนดวิธีการเรียก POST
      url: "https://api.line.me/v2/bot/chat/loading/start", // URL สำหรับการเริ่มการโหลด
      headers: LINE_HEADER, // ใส่ headers ที่กำหนดไว้
      data: { chatId: userId }, // ส่งค่า chatId ของผู้ใช้
    });
  }

  // ฟังก์ชันสำหรับดึงข้อมูลโปรไฟล์ของผู้ใช้
  async getProfile(userId) {
    try {
      // ทำการเรียก API เพื่อดึงข้อมูลโปรไฟล์ของผู้ใช้
      const response = await axios({
        method: "get",
        headers: LINE_HEADER,
        url: `https://api.line.me/v2/bot/profile/${userId}`,
      });
      return response.data; // ส่งกลับข้อมูลโปรไฟล์ที่ได้รับ
    } catch (error) {
      console.error("Error getting profile:", error);
      throw error; // ส่งต่อ error เพื่อให้ handler จัดการ
    }
  }
}

// ส่งออกอินสแตนซ์ของคลาส LINE เพื่อให้สามารถใช้งานได้ในที่อื่น
export default new LINE();