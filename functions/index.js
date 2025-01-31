// นำเข้าฟังก์ชัน onRequest จาก Firebase Functions สำหรับจัดการ HTTPS request
import { onRequest } from "firebase-functions/v2/https"
// นำเข้าโมดูลต่างๆ ที่จำเป็น
import line from "./utils/line.js"
import gemini from "./utils/gemini.js"
import imagetotext from "./utils/imagetotext.js"
import sharp from "sharp"
import NodeCache from "node-cache"
import validator from "validator"
import speech from "@google-cloud/speech"
import path from "path"
import os from "os"
import fs from "fs"
// นำเข้า fluent-ffmpeg
import ffmpeg from "fluent-ffmpeg"

// Instantiates a client
const client = new speech.SpeechClient()

// สร้าง instance ของ NodeCache สำหรับแคชข้อมูล
const webhookCache = new NodeCache({ stdTTL: 300, checkperiod: 60 })

// ฟังก์ชันตรวจสอบ URL
const isUrl = (string) => validator.isURL(string, { require_protocol: true })

const getSystemInfo = () => {
  const uptimeInSeconds = os.uptime()

  // คำนวณเวลา Uptime ในรูปแบบ 0d 9h 50m 39s
  const days = Math.floor(uptimeInSeconds / 86400)
  const hours = Math.floor((uptimeInSeconds % 86400) / 3600)
  const minutes = Math.floor((uptimeInSeconds % 3600) / 60)
  const seconds = Math.floor(uptimeInSeconds % 60)

  // คำนวณหน่วยความจำ (Memory) ด้วยวิธีที่แม่นยำ
  const totalMemory = os.totalmem()
  const freeMemory = os.freemem()
  const usedMemory = totalMemory - freeMemory

  // แปลงหน่วยความจำเป็น GB และจำกัดทศนิยม 2 ตำแหน่ง
  const totalMemoryGB = (totalMemory / 1024 ** 3).toFixed(2)
  const usedMemoryGB = (usedMemory / 1024 ** 3).toFixed(2)
  const freeMemoryGB = (freeMemory / 1024 ** 3).toFixed(2)

  // คำนวณเปอร์เซ็นต์การใช้หน่วยความจำ
  const memoryUsagePercent = ((usedMemory / totalMemory) * 100).toFixed(1)

  // รับข้อมูล CPU โดยละเอียด
  const cpus = os.cpus()
  const cpuModel = cpus[0].model.replace(/\s+/g, " ").trim() // ลบช่องว่างที่ไม่จำเป็น
  const cpuSpeed = (cpus[0].speed / 1000).toFixed(2) // แปลงเป็น GHz

  // คำนวณโหลดเฉลี่ยของ CPU
  const loadAvg = os.loadavg()
  const cpuLoadPercent = ((loadAvg[0] * 100) / cpus.length).toFixed(1)

  return {
    NodeVersion: process.version,
    OS: `${os.type()} ${os.arch()} ${os.release()}`,
    Platform: os.platform(),
    CPU: {
      Model: cpuModel,
      Speed: `${cpuSpeed} GHz`,
      Cores: cpus.length,
      LoadPercent: `${cpuLoadPercent}%`,
    },
    Memory: {
      Total: `${totalMemoryGB} GB`,
      Used: `${usedMemoryGB} GB`,
      Free: `${freeMemoryGB} GB`,
      UsagePercent: `${memoryUsagePercent}%`,
    },
    Uptime: `${days}d ${hours}h ${minutes}m ${seconds}s`,
    SystemUptime: process.uptime().toFixed(0) + "s",
  }
}

// ปรับปรุงฟังก์ชัน createSystemInfoFlex ให้แสดงข้อมูลใหม่
const createSystemInfoFlex = (systemInfo) => {
  return {
    type: "flex",
    altText: "ข้อมูลระบบเซิร์ฟเวอร์ 🖥️",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "ข้อมูลระบบเซิร์ฟเวอร์ 🖥️",
            weight: "bold",
            size: "xl",
            align: "center",
            margin: "md",
            color: "#ffffff",
          },
          {
            type: "separator",
            margin: "md",
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: `OS: ${systemInfo.OS}`,
                color: "#ffffff",
                wrap: true,
              },
              {
                type: "text",
                text: `Platform: ${systemInfo.Platform}`,
                color: "#ffffff",
                wrap: true,
              },
              {
                type: "text",
                text: `Node.js: ${systemInfo.NodeVersion}`,
                color: "#ffffff",
                wrap: true,
              },
              {
                type: "text",
                text: `CPU: ${systemInfo.CPU.Model}`,
                color: "#ffffff",
                wrap: true,
              },
              {
                type: "text",
                text: `CPU Speed: ${systemInfo.CPU.Speed}`,
                color: "#ffffff",
                wrap: true,
              },
              {
                type: "text",
                text: `CPU Cores: ${systemInfo.CPU.Cores}`,
                color: "#ffffff",
                wrap: true,
              },
              {
                type: "text",
                text: `CPU Load: ${systemInfo.CPU.LoadPercent}`,
                color: "#ffffff",
                wrap: true,
              },
              {
                type: "text",
                text: `Memory Total: ${systemInfo.Memory.Total}`,
                color: "#ffffff",
                wrap: true,
              },
              {
                type: "text",
                text: `Memory Used: ${systemInfo.Memory.Used} (${systemInfo.Memory.UsagePercent})`,
                color: "#ffffff",
                wrap: true,
              },
              {
                type: "text",
                text: `Memory Free: ${systemInfo.Memory.Free}`,
                color: "#ffffff",
                wrap: true,
              },
              {
                type: "text",
                text: `System Uptime: ${systemInfo.Uptime}`,
                color: "#ffffff",
                wrap: true,
              },
            ],
          },
        ],
      },
      styles: {
        body: { backgroundColor: "#2e3b55" },
      },
    },
  }
}

// ฟังก์ชันแปลงไฟล์ .m4a เป็น .wav โดยใช้ fluent-ffmpeg
const convertM4aToWav = async (m4aLocalFile, wavLocalFile) => {
  return new Promise((resolve, reject) => {
    ffmpeg(m4aLocalFile)
      .toFormat("wav")
      .audioCodec("pcm_s16le") // ใช้ codec ที่มีประสิทธิภาพ
      .audioChannels(1) // แปลงเป็น mono เพื่อลดขนาดไฟล์
      .audioFrequency(16000) // ตั้งค่า sample rate ให้ตรงกับที่ Google Speech-to-Text ต้องการ
      .on("end", () => {
        console.log("Conversion finished!")
        resolve()
      })
      .on("error", (err) => {
        console.error("An error occurred: " + err.message)
        reject(err)
      })
      .save(wavLocalFile)
  })
}

// ฟังก์ชันสำหรับ Google Cloud Speech-to-Text
const transcribeSpeech = async (wavFilename) => {
  const audio = {
    content: fs.readFileSync(wavFilename).toString("base64"),
  }

  const config = {
    encoding: "LINEAR16",
    sampleRateHertz: 16000,
    languageCode: "th-TH", // ภาษาหลัก
    alternativeLanguageCodes: ["en-US"], // ภาษาสำรอง
    model: "latest_long",
    enableWordConfidence: true,
    useEnhanced: true,
  }
  const request = {
    audio: audio,
    config: config,
  }

  const [response] = await client.recognize(request)
  const transcription = await response.results
    .map((result) => result.alternatives[0].transcript)
    .join("\n")

  const charCount = transcription.length
  console.log(`จำนวนตัวอักษร: ${charCount}`)

  console.log("Result: ", JSON.stringify(response.results))
  return transcription
}

// ฟังก์ชันสำหรับส่งข้อความต้อนรับสมาชิกใหม่
const sendWelcomeMessage = async (event) => {
  const promises = event.joined.members.map(async (member) => {
    if (member.type === "user") {
      await line.reply(event.replyToken, [
        {
          type: "textV2",
          text: "สวัสดีคุณ✨ {user1}! ยินดีต้อนรับ \n ทุกคน {everyone} 💕 มีเพื่อนใหม่เข้ามาอย่าลืมทักทายกันนะ🙌",
          substitution: {
            user1: {
              type: "mention",
              mentionee: { type: "user", userId: member.userId },
            },
            everyone: {
              type: "mention",
              mentionee: { type: "all" },
            },
          },
        },
      ])
    }
  })
  await Promise.all(promises)
}

// สร้างฟังก์ชันสำหรับส่งข้อความต้อนรับเมื่อมีผู้ติดตามใหม่
const sendWelcomeFlex = async (event, userId) => {
  try {
    const profile = await line.getProfile(userId)
    const welcomeFlex = {
      type: "flex",
      altText: event.follow?.isUnblocked
        ? "ยินดีต้อนรับกลับมาอีกครั้ง! 😁"
        : `สวัสดีค่ะ 🙌 ฉันชื่อ Panya AI ฉันพร้อมช่วยสรุปเนื้อหาให้อ่านง่ายและรวดเร็วเพียงส่ง ลิงก์,รูปภาพ หรือข้อความมาได้เลยค่ะ 😊`,
      contents: {
        type: "bubble",
        size: "mega",
        hero: {
          type: "image",
          url: profile?.pictureUrl || "https://i.postimg.cc/brr7Fmw9/user.png",
          size: "full",
          aspectRatio: "20:13",
          aspectMode: "cover",
        },
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text:
                "ชื่อผู้ใช้ 🪴 : " + (profile?.displayName || "Unknown User"),
              weight: "bold",
              size: "lg",
              margin: "md",
              align: "center",
              color: "#F5F7F8",
            },
            {
              type: "text",
              text: event.follow?.isUnblocked
                ? "ยินดีต้อนรับกลับมาอีกครั้ง! 😁"
                : `สวัสดีค่ะ ฉันชื่อ Panya AI ฉันสามารถช่วยคุณสรุปเนื้อหาให้อ่านง่ายและรวดเร็วค่ะ 😊`,
              wrap: true,
              size: "md",
              color: "#F5F7F8",
              margin: "lg",
              align: "center",
            },
            {
              type: "text",
              text:
                "วันที่ 📅 : " +
                new Date().toLocaleDateString("th-TH", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                }),
              size: "md",
              color: "#F5F7F8",
              margin: "lg",
              align: "center",
            },
          ],
        },
        styles: {
          body: {
            backgroundColor: "#484c6c",
          },
        },
      },
    }
    const stickerMessage = {
      type: "sticker",
      packageId: "11539",
      stickerId: "52114114",
    }
    await line.reply(event.replyToken, [welcomeFlex, stickerMessage])
  } catch (err) {
    console.error("Error getting profile:", err)
  }
}

const manualChatbot = {
  type: "flex",
  altText: "วิธีการใช้งานแชทบอท AI 📚",
  contents: {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "วิธีการใช้งานแชทบอท AI 📚",
          align: "center",
          weight: "bold",
          size: "lg",
          color: "#FFFFFF",
        },
      ],
      backgroundColor: "#7E5CAD",
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "แชทบอทนี้สามารถตอบสนองต่อความต้องการที่หลากหลายผ่านฟังก์ชันการทำงานดังนี้ :",
          wrap: true,
          margin: "md",
        },
        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "baseline",
              contents: [
                {
                  type: "text",
                  text: "1. ตอบคำถามและค้นหาข้อมูล🔎 :",
                  weight: "bold",
                  flex: 0,
                },
              ],
            },
            {
              type: "text",
              text: 'พิมพ์คำถามหรือข้อมูลที่ต้องการทราบ เช่น "ระบบสุริยะมีกี่ดาวเคราะห์?" แชทบอทจะตอบคำถามหรือให้ข้อมูลเพิ่มเติมทันที',
              wrap: true,
              margin: "sm",
            },
            {
              type: "box",
              layout: "baseline",
              contents: [
                {
                  type: "text",
                  text: "2. สรุปเนื้อหาจากไฟล์รูปภาพ🖼️ :",
                  weight: "bold",
                  flex: 0,
                },
              ],
            },
            {
              type: "text",
              text: 'อัปโหลดรูปภาพที่มีข้อความหรือข้อมูลสำคัญโดยคลิกปุ่ม "อัปโหลดรูปภาพ" จากนั้นแชทบอทจะวิเคราะห์และสรุปข้อความในภาพให้',
              wrap: true,
              margin: "sm",
            },
            {
              type: "box",
              layout: "baseline",
              contents: [
                {
                  type: "text",
                  text: "3. สรุปเนื้อหาจาก URL หรือเว็บไซต์🌏 :",
                  weight: "bold",
                  flex: 0,
                },
              ],
            },
            {
              type: "text",
              text: "คัดลอก URL เว็บไซต์ที่ต้องการพร้อมวางลิงก์ในแชท แชทบอทจะดึงข้อมูลและสรุปให้",
              wrap: true,
              margin: "sm",
            },
            {
              type: "box",
              layout: "baseline",
              contents: [
                {
                  type: "text",
                  text: "4. สรุปเนื้อหาจากข้อความ💬 :",
                  weight: "bold",
                  flex: 0,
                },
              ],
            },
            {
              type: "text",
              text: "วางข้อความยาวที่ต้องการให้สรุปลงในแชท แชทบอทจะช่วยย่อข้อความและสรุปประเด็นสำคัญ",
              wrap: true,
              margin: "sm",
            },
            {
              type: "box",
              layout: "baseline",
              contents: [
                {
                  type: "text",
                  text: "5. ตอบโต้ด้วยข้อความเสียง🎙️ :",
                  weight: "bold",
                  flex: 0,
                },
              ],
            },
            {
              type: "text",
              text: 'คลิกปุ่ม "ส่งข้อความเสียง" หรือ "อัปโหลดไฟล์เสียง" แล้วพูดหรือส่งไฟล์เสียงที่มีคำถามหรือเนื้อหา ระบบจะถอดข้อความเสียงและให้คำตอบหรือสรุปข้อมูลให้',
              wrap: true,
              margin: "sm",
            },
          ],
        },
      ],
    },
  },
}

// ฟังก์ชันสำหรับจัดการข้อความประเภทต่างๆ
const handleMessage = async (event, userId, prompt, quoteToken) => {
  await line.loading(userId)
  const quickReply = {
    items: [
      {
        type: "action",
        action: {
          type: "message",
          label: "สวัสดี 🙌",
          text: "สวัสดี 😁",
        },
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "วันนี้วันที่เท่าไหร่? 📅",
          text: "วันนี้วันที่เท่าไหร่",
        },
      },
      {
        type: "action",
        action: {
          type: "cameraRoll",
          label: "เลือกรูปภาพ 🖼️",
        },
      },
      {
        type: "action",
        action: {
          type: "location",
          label: "คุณภาพอากาศและอุณหภูมิ 🌡️",
        },
      },
      {
        type: "action",
        action: {
          type: "camera",
          label: "ถ่ายรูป 📸",
        },
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "ประโยคให้กำลังใจ 💕",
          text: "ขอประโยคให้กำลังใจในวันที่แย่หรือเหนื่อย,หมดกำลังใจ",
        },
      },
    ],
  }
  const mentionPromises =
    event.message.mention && event.message.mention.mentionees
      ? event.message.mention.mentionees.map(async (mentionee) => {
          if (mentionee.isSelf === true) {
            await line.reply(
              event.replyToken,
              [
                {
                  type: "textV2",
                  text: "ว่ายังไงคะ😊 ถามได้เลยนะ😉 {user1}",
                  substitution: {
                    user1: {
                      type: "mention",
                      mentionee: { type: "user", userId: event.source.userId },
                    },
                  },
                  quoteToken: quoteToken,
                },
              ],
              quickReply
            )
          }
        })
      : []
  await Promise.all(mentionPromises)
  if (event.message.type === "text") {
    await handleTextMessage(event, prompt, quoteToken, quickReply)
  } else if (event.message.type === "image") {
    await handleImageMessage(event, quoteToken, quickReply)
  } else if (event.message.type === "audio") {
    await handleAudioMessage(event, quoteToken, quickReply)
  } else if (event.message.type === "location") {
    await handleLocationMessage(event, quoteToken, quickReply) // เพิ่มฟังก์ชันสำหรับ location
  }
}

// ฟังก์ชันสำหรับจัดการข้อความประเภท Text
const handleTextMessage = async (event, prompt, quoteToken, quickReply) => {
  const cacheKey = `text:${prompt}`
  const cachedText = webhookCache.get(cacheKey)
  if (cachedText) {
    await line.reply(
      event.replyToken,
      [{ type: "text", text: cachedText, quoteToken }],
      quickReply
    )
    return
  }
  try {
    const generatedText = isUrl(prompt)
      ? await gemini.urlToText(prompt)
      : await gemini.textOnly(prompt)
    webhookCache.set(cacheKey, generatedText, 60)
    await line.reply(
      event.replyToken,
      [{ type: "text", text: generatedText, quoteToken }],
      quickReply
    )
  } catch (error) {
    console.error("Error processing text message:", error)
    await line.reply(
      event.replyToken,
      [
        {
          type: "text",
          text: "เกิดข้อผิดพลาดในการประมวลผลข้อความ",
          quoteToken,
        },
      ],
      quickReply
    )
  }
}

// ฟังก์ชันสำหรับจัดการข้อความประเภท Image
const handleImageMessage = async (event, quoteToken, quickReply) => {
  try {
    const ImageBinary = await line.getImageBinary(event.message.id)
    if (!ImageBinary) {
      await line.reply(
        event.replyToken,
        [{ type: "text", text: "ไม่สามารถรับรูปภาพได้", quoteToken }],
        quickReply
      )
      return
    }
    const ImageBase64 = await sharp(ImageBinary)
      .toFormat("jpeg", { quality: 80 })
      .toBuffer()
      .then((data) => data.toString("base64"))
    const cacheKeyImage = `image:${ImageBase64}`
    const cachedImageText = webhookCache.get(cacheKeyImage)
    if (cachedImageText) {
      await line.reply(
        event.replyToken,
        [{ type: "text", text: cachedImageText, quoteToken }],
        quickReply
      )
      return
    }
    const generatedText = await imagetotext.multimodal(ImageBase64)
    webhookCache.set(cacheKeyImage, generatedText, 60)
    await line.reply(
      event.replyToken,
      [{ type: "text", text: generatedText, quoteToken }],
      quickReply
    )
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการประมวลผลรูปภาพ:", error)
    await line.reply(
      event.replyToken,
      [{ type: "text", text: "เกิดข้อผิดพลาดในการประมวลผลรูปภาพ", quoteToken }],
      quickReply
    )
  }
}

// ฟังก์ชันสำหรับจัดการข้อความประเภท Audio
const handleAudioMessage = async (event, quoteToken, quickReply) => {
  try {
    const messageId = event.message.id
    // ตรวจสอบ messageId ก่อนเรียก getAudio
    if (!messageId || typeof messageId !== "string") {
      console.error("Invalid messageId in handleAudioMessage:", messageId)
      await line.reply(event.replyToken, [
        { type: "text", text: "เกิดข้อผิดพลาดในการประมวลผลไฟล์เสียง" },
      ])
      return // หยุดการทำงาน
    }
    // ดึงไฟล์เสียงจาก LINE
    const audioFile = await line.getAudio(event.message.id)
    // บันทึกไฟล์เสียง .m4a
    const filenameTimestamp = event.timestamp
    const m4aLocalFile = path.join(os.tmpdir(), filenameTimestamp + ".m4a")
    fs.writeFileSync(m4aLocalFile, audioFile)

    // แปลงไฟล์ .m4a เป็น .wav โดยใช้ fluent-ffmpeg
    const wavLocalFile = path.join(os.tmpdir(), filenameTimestamp + ".wav")
    await convertM4aToWav(m4aLocalFile, wavLocalFile)

    // แปลงเสียงเป็นข้อความ
    const resultText = await transcribeSpeech(wavLocalFile)
    // ส่งข้อความที่แปลงแล้วไปยัง Gemini API
    const geminiResponse = await gemini.textOnly(resultText)
    // ตอบกลับด้วยข้อความจาก Gemini API
    await line.reply(
      event.replyToken,
      [{ type: "text", text: geminiResponse, quoteToken }],
      quickReply
    )
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการประมวลผลไฟล์เสียง:", error)
    await line.reply(
      event.replyToken,
      [
        {
          type: "text",
          text: "เกิดข้อผิดพลาดในการประมวลผลไฟล์เสียง",
          quoteToken,
        },
      ],
      quickReply
    )
  }
}

// ฟังก์ชันสำหรับจัดการข้อความประเภท Location (เพิ่มเข้ามาใหม่)
const handleLocationMessage = async (event, quoteToken, quickReply) => {
  const latitude = event.message.latitude
  const longitude = event.message.longitude
  const Address = event.message.address

  // เรียก IQAir API
  const apiKey = "a15ac9f5-48e1-45f0-962a-81bb4af574c9" // แทนที่ด้วย API Key ของคุณ
  const apiUrl = `http://api.airvisual.com/v2/nearest_city?lat=${latitude}&lon=${longitude}&key=${apiKey}`

  try {
    const response = await fetch(apiUrl)
    const data = await response.json()

    if (data.status === "success") {
      const { tp, hu, ws, ic, pr } = data.data.current.weather // เพิ่ม pr (ความกดอากาศ)
      const { aqius: aqi, maincn } = data.data.current.pollution

      // สร้างข้อความแสดงผล
      let message = `📍 สถานที่: ${Address}\n`
      message += `🌏 พิกัด: ${latitude}, ${longitude}\n`
      message += `☁️ สภาพอากาศ: ${ic} \n`
      message += `🌡️ อุณหภูมิ: ${tp}°C\n`
      message += `💧 ความชื้น: ${hu}%\n`
      message += `💨 ความเร็วลม: ${ws} m/s\n`
      message += `🌀 ความกดอากาศ: ${pr} hPa\n\n` // เพิ่มความกดอากาศ
      message += `🍃 คุณภาพอากาศ:\n`
      message += `AQI: ${aqi} (${getAQIDescription(aqi)})\n`
      message += `มลพิษทางอากาศหลัก: ${maincn}\n`

      // เพิ่มข้อมูลเพิ่มเติมเกี่ยวกับ AQI
      message += `\nข้อมูลเพิ่มเติมเกี่ยวกับ AQI:\n`
      message += `- ${getAQIInfo(aqi)}\n`

      await line.reply(
        event.replyToken,
        [{ type: "text", text: message, quoteToken }],
        quickReply
      )
    } else {
      console.error("เกิดข้อผิดพลาดในการเรียก IQAir API:", data.data)
      await line.reply(
        event.replyToken,
        [
          {
            type: "text",
            text: "ขออภัย เกิดข้อผิดพลาดในการดึงข้อมูลคุณภาพอากาศ",
            quoteToken,
          },
        ],
        quickReply
      )
    }
  } catch (error) {
    console.error("เกิดข้อผิดพลาด:", error)
    await line.reply(
      event.replyToken,
      [
        {
          type: "text",
          text: "ขออภัย เกิดข้อผิดพลาดในการประมวลผล",
          quoteToken,
        },
      ],
      quickReply
    )
  }
}

// ฟังก์ชันสำหรับคำอธิบาย AQI (สามารถปรับแต่งเพิ่มเติมได้)
const getAQIDescription = (aqi) => {
  if (aqi <= 50) {
    return "ดี"
  } else if (aqi <= 100) {
    return "ปานกลาง"
  } else if (aqi <= 150) {
    return "มีผลกระทบต่อกลุ่มเสี่ยง"
  } else if (aqi <= 200) {
    return "ไม่ดีต่อสุขภาพ"
  } else if (aqi <= 300) {
    return "แย่มาก"
  } else {
    return "อันตราย"
  }
}

// ฟังก์ชันสำหรับให้ข้อมูลเพิ่มเติมเกี่ยวกับ AQI (สามารถปรับแต่งเพิ่มเติมได้)
const getAQIInfo = (aqi) => {
  if (aqi <= 50) {
    return "คุณภาพอากาศดีมาก เหมาะสำหรับการทำกิจกรรมกลางแจ้ง"
  } else if (aqi <= 100) {
    return "คุณภาพอากาศปานกลาง ควรระมัดระวังสำหรับผู้ที่มีความไวต่อมลพิษทางอากาศ"
  } else if (aqi <= 150) {
    return "คุณภาพอากาศเริ่มมีผลกระทบต่อสุขภาพ ผู้ป่วยโรคหัวใจและระบบทางเดินหายใจควรหลีกเลี่ยงการทำกิจกรรมกลางแจ้ง"
  } else if (aqi <= 200) {
    return "คุณภาพอากาศไม่ดีต่อสุขภาพ ควรลดระยะเวลาการทำกิจกรรมกลางแจ้ง"
  } else if (aqi <= 300) {
    return "คุณภาพอากาศแย่มาก หลีกเลี่ยงการทำกิจกรรมกลางแจ้ง"
  } else {
    return "คุณภาพอากาศอันตราย งดการทำกิจกรรมกลางแจ้ง"
  }
}

// สร้างฟังก์ชัน webhook หลัก
export const webhook = onRequest(
  {
    memory: "4GB",
    cors: true,
    region: "asia-southeast1",
    timeoutSeconds: 300,
  },
  async (req, res) => {
    const events = req.body.events
    if (!events || !Array.isArray(events)) {
      return res.status(400).send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>400 Bad Request 😵</title>
    <style>
      body {
        margin: 0;
        font-family: Menlo, Monaco, Consolas, "Courier New", Courier;
        background: url("https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExODB5Z3Y4dnEzanVqODg1cWcwdGhmMTVvdDI5aTc1aGdzYTE4NTFoNiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Ju7l5y9osyymQ/giphy.gif");
        background-size: cover;
        /* ปรับขนาดรูปให้เต็มจอ */
        background-position: center;
        /* จัดรูปตรงกลาง */
        background-repeat: no-repeat;
        /* ไม่ให้รูปซ้ำ */
        overflow: hidden;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
      }

      #particles-js {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: -1;
      }

      .terminal-window {
        text-align: left;
        width: 80%;
        max-width: 600px;
        height: 80%;
        max-height: 400px;
        border-radius: 10px;
        background: #30353a;
        color: #fff;
        box-shadow: 2px 2px 8px 4px rgba(0, 0, 0, 0.29);
        display: flex;
        flex-direction: column;
      }

      header {
        background: #e0e8f0;
        padding: 10px;
        border-radius: 10px 10px 0 0;
      }

      header .button {
        display: inline-block;
        width: 15px;
        height: 15px;
        border-radius: 55%;
        margin-right: 5px;
      }

      .button.green {
        background: #3bb662;
      }

      .button.yellow {
        background: #e5c30f;
      }

      .button.red {
        background: #e75448;
      }

      .terminal {
        padding: 20px;
        font-size: 12px;
        line-height: 1.5;
        flex-grow: 1;
        overflow-y: auto;
      }

      /* Media Query for Small Devices (Mobile) */
      @media (max-width: 768px) {
        .terminal-window {
          width: 90%;
          max-width: 100%;
          height: auto;
          max-height: 80vh;
        }

        .terminal {
          font-size: 10px;
          padding: 15px;
        }
      }

      /* Media Query for Extra Small Devices (Portrait Mobile) */
      @media (max-width: 480px) {
        .terminal-window {
          width: 95%;
          height: auto;
          max-height: 75vh;
        }

        .terminal {
          font-size: 9px;
          padding: 10px;
        }
      }
      .green {
        color: #3bb662;
      }
    </style>
  </head>
  <body>
    <div id="particles-js"></div>
    <div class="terminal-window">
      <header>
        <div class="button green"></div>
        <div class="button yellow"></div>
        <div class="button red"></div>
      </header>
      <div class="terminal">
        <div class="history">
          <h1>400 Bad Request 😵</h1>
          ----------------------------------------------<br />
          C:User/Panyarin-AI/function/index.js<br /><br />
          === Deploying to 'panyarin-ai' ===<br />
          <span class="green">✅</span> deploying functions<br />
          <span class="green">✅</span> functions: generating the service
          identity for pubsub.googleapis.com...<br />
          <span class="green">✅</span> functions: generating the service
          identity for eventarc.googleapis.com...<br />
          <span class="green">✅</span> functions: folder uploaded
          successfully<br />
          <span class="green">✅</span> functions: updating Node.js 22 (2nd Gen)
          function webhook(asia-southeast1)...<br />
          <span class="green">✅</span> functions[webhook(asia-southeast1)]:
          Successful update operation.<br />
          <span class="green">✅</span> functions: cleaning up build files...<br />
          Deploy complete!
        </div>
      </div>
    </div>
  </body>
</html>`)
    }

    const eventPromises = events.map(async (event) => {
      const userId = event.source.userId
      console.log("User ID : ", userId)
      try {
        if (event.type === "memberJoined") {
          await sendWelcomeMessage(event)
        } else if (event.type === "follow") {
          await sendWelcomeFlex(event, userId)
        } else if (event.type === "message") {
          const prompt = event.message.text?.trim() || ""

          if (prompt === "ข้อมูลระบบ") {
            const systemInfo = getSystemInfo() // เรียกฟังก์ชันเพื่อดึงข้อมูลระบบ
            const systemFlex = createSystemInfoFlex(systemInfo) // สร้าง Flex Message
            await line.reply(event.replyToken, [systemFlex]) // ส่งข้อความ Flex กลับไป
          } else if (prompt === "คู่มือการใช้งาน") {
            const manual = manualChatbot // เรียกฟังก์ชันเพื่อดึงคู่มือการใช้งาน
            await line.reply(event.replyToken, [manual]) // ส่งข้อความ Flex กลับไป
          } else {
            console.log("Prompt :", prompt)
            const quoteToken = event.message.quoteToken
            await handleMessage(event, userId, prompt, quoteToken)
          }
        }
      } catch (error) {
        console.error("Error processing event: ", error)
        await line.reply(event.replyToken, [
          { type: "text", text: "เกิดข้อผิดพลาดลองใหม่อีกครั้งในภายหลัง" },
        ])
      }
    })
    await Promise.all(eventPromises)
    res.status(200).end()
  }
)
