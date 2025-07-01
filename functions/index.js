// index.js (เวอร์ชัน Express.js สำหรับ AWS Lambda และแพลตฟอร์มอื่นๆ)
// โค้ดนี้สามารถรันบนเครื่องเพื่อทดสอบ และ deploy ขึ้น AWS Lambda ได้โดยตรง

// --- ส่วนที่ 1: Imports ---
import express from "express"
import serverless from "serverless-http"
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
import ffmpeg from "fluent-ffmpeg"
import PQueue from "p-queue"

// --- ส่วนที่ 2: การตั้งค่าที่ขึ้นกับสภาพแวดล้อม (Environment-dependent Configuration) ---

// ตั้งค่า Path ของ FFMPEG แบบไดนามิก
// ตรวจสอบว่ากำลังรันบน AWS Lambda หรือไม่
if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  // บน Lambda, binary file จาก Layer จะอยู่ที่ /opt/bin/
  // **สำคัญ:** ต้องเพิ่ม FFMPEG Lambda Layer ในการตั้งค่าฟังก์ชัน Lambda ของคุณ
  ffmpeg.setFfmpegPath("/opt/bin/ffmpeg")
} else {
  // สำหรับการรันบนเครื่อง (Local Development) จะใช้จาก node_modules
  import("@ffmpeg-installer/ffmpeg").then((ffmpegInstaller) => {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path)
  })
}

// Instantiates a client สำหรับ Google Cloud Speech-to-Text
const client = new speech.SpeechClient()

// สร้าง instance ของ NodeCache และ PQueue
const webhookCache = new NodeCache({
  stdTTL: 600,
  checkperiod: 120,
  useClones: false,
})
const queue = new PQueue({ concurrency: 3 })

// --- ส่วนที่ 3: ฟังก์ชัน Helper และ Business Logic ทั้งหมด (คัดลอกมาจากไฟล์เดิม) ---

// ฟังก์ชันตรวจสอบ URL
const isUrl = (string) => validator.isURL(string, { require_protocol: true })

// ฟังก์ชันดึงข้อมูลระบบ
const getSystemInfo = () => {
  const uptimeInSeconds = os.uptime()
  const days = Math.floor(uptimeInSeconds / 86400)
  const hours = Math.floor((uptimeInSeconds % 86400) / 3600)
  const minutes = Math.floor((uptimeInSeconds % 3600) / 60)
  const seconds = Math.floor(uptimeInSeconds % 60)
  const totalMemory = os.totalmem()
  const freeMemory = os.freemem()
  const usedMemory = totalMemory - freeMemory
  const totalMemoryGB = (totalMemory / 1024 ** 3).toFixed(2)
  const usedMemoryGB = (usedMemory / 1024 ** 3).toFixed(2)
  const freeMemoryGB = (freeMemory / 1024 ** 3).toFixed(2)
  const memoryUsagePercent = ((usedMemory / totalMemory) * 100).toFixed(1)
  const cpus = os.cpus()
  const cpuModel = cpus[0].model.replace(/\s+/g, " ").trim()
  const cpuSpeed = (cpus[0].speed / 1000).toFixed(2)
  const loadAvg = os.loadavg()
  const cpuLoadPercent = ((loadAvg[0] * 100) / cpus.length).toFixed(1)

  if (parseFloat(cpuLoadPercent) > 80) {
    console.warn("CPU Load สูงเกินไป! อาจมีผลต่อประสิทธิภาพ.")
  }

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

// ฟังก์ชันสร้าง Flex Message แสดงข้อมูลระบบ
const createSystemInfoFlex = (systemInfo) => ({
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
        { type: "separator", margin: "md" },
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
    styles: { body: { backgroundColor: "#2e3b55" } },
  },
})

// ฟังก์ชันแปลง .m4a เป็น .wav
const convertM4aToWav = async (m4aLocalFile, wavLocalFile) =>
  new Promise((resolve, reject) => {
    ffmpeg(m4aLocalFile)
      .inputOptions("-y")
      .outputOptions("-preset ultrafast")
      .toFormat("wav")
      .audioCodec("pcm_s16le")
      .audioChannels(1)
      .audioFrequency(16000)
      .on("end", () => {
        console.log("✅ FFmpeg: Conversion finished")
        if (fs.existsSync(m4aLocalFile)) fs.unlinkSync(m4aLocalFile)
        resolve()
      })
      .on("error", (err) => {
        console.error("❌ FFmpeg error:", err.message)
        if (fs.existsSync(m4aLocalFile)) fs.unlinkSync(m4aLocalFile)
        if (fs.existsSync(wavLocalFile)) fs.unlinkSync(wavLocalFile)
        reject(err)
      })
      .save(wavLocalFile)
  })

// ฟังก์ชันสำหรับ Google Cloud Speech-to-Text
const transcribeSpeech = async (wavFilename) => {
  const audio = { content: fs.readFileSync(wavFilename).toString("base64") }
  const config = {
    encoding: "LINEAR16",
    sampleRateHertz: 16000,
    languageCode: "th-TH",
    alternativeLanguageCodes: ["en-US"],
    model: "latest_long",
    enableWordConfidence: true,
    useEnhanced: true,
  }
  const request = { audio, config }
  const [response] = await client.recognize(request)
  const transcription = response.results
    .map((result) => result.alternatives[0].transcript)
    .join("\n")
  console.log(`จำนวนตัวอักษร: ${transcription.length}`)
  return transcription
}

// ฟังก์ชันส่งข้อความต้อนรับสมาชิกใหม่
const sendWelcomeMessage = async (event) => {
  const promises = event.joined.members.map(async (member) => {
    if (member.type === "user") {
      await line.reply(event.replyToken, [
        {
          type: "textV2",
          text: "สวัสดีคุณ✨ {user1}! ยินดีต้อนรับ \n ทุกคน {everyone} 💕 มีเพื่อนใหม่เข้ามา อย่าลืมทักทายกันนะ🙌",
          substitution: {
            user1: {
              type: "mention",
              mentionee: { type: "user", userId: member.userId },
            },
            everyone: { type: "mention", mentionee: { type: "all" } },
          },
        },
      ])
    }
  })
  await Promise.all(promises)
}

// ฟังก์ชันสำหรับส่งข้อความต้อนรับเมื่อมีผู้ติดตามใหม่
const sendWelcomeFlex = async (event, userId) => {
  try {
    const profile = await line.getProfile(userId)
    const welcomeFlex = {
      type: "flex",
      altText: event.follow?.isUnblocked
        ? "ยินดีต้อนรับกลับมาอีกครั้ง! 😁"
        : `สวัสดีค่ะ 🙌 ฉันชื่อ Panya AI ฉันพร้อมช่วยสรุปเนื้อหาให้อ่านง่ายและรวดเร็ว เพียงส่ง ลิงก์, รูปภาพ หรือข้อความมาได้เลยค่ะ 😊`,
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
        styles: { body: { backgroundColor: "#484c6c" } },
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

// ข้อความคู่มือการใช้งานแชทบอท AI (Flex Message)
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
        action: { type: "message", label: "สวัสดี 🙌", text: "สวัสดี 😁" },
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
        action: { type: "cameraRoll", label: "เลือกรูปภาพ 🖼️" },
      },
      {
        type: "action",
        action: { type: "location", label: "คุณภาพอากาศและอุณหภูมิ 🌡️" },
      },
      { type: "action", action: { type: "camera", label: "ถ่ายรูป 📸" } },
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

  if (event.message.mention && event.message.mention.mentionees) {
    const mentionPromises = event.message.mention.mentionees.map(
      async (mentionee) => {
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
      }
    )
    await Promise.all(mentionPromises)
  }

  if (event.message.type === "text") {
    await handleTextMessage(event, prompt, quoteToken, quickReply)
  } else if (event.message.type === "image") {
    await handleImageMessage(event, quoteToken, quickReply)
  } else if (event.message.type === "audio") {
    await handleAudioMessage(event, quoteToken, quickReply)
  } else if (event.message.type === "location") {
    await handleLocationMessage(event, quoteToken, quickReply)
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
      ? await queue.add(() => gemini.urlToText(prompt))
      : await queue.add(() => gemini.textOnly(prompt))
    webhookCache.set(cacheKey, generatedText, 600)
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
      .resize(512, 512, { fit: "inside" })
      .toFormat("jpeg", { quality: 75 })
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
    webhookCache.set(cacheKeyImage, generatedText, 600)
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
    const audioFile = await line.getAudio(messageId)
    const timestamp = event.timestamp
    const m4aLocalFile = path.join(os.tmpdir(), `${timestamp}.m4a`)
    const wavLocalFile = path.join(os.tmpdir(), `${timestamp}.wav`)
    fs.writeFileSync(m4aLocalFile, audioFile)
    await convertM4aToWav(m4aLocalFile, wavLocalFile)
    const resultText = await transcribeSpeech(wavLocalFile)
    if (fs.existsSync(wavLocalFile)) fs.unlinkSync(wavLocalFile)
    const geminiResponse = await queue.add(() => gemini.textOnly(resultText))
    await line.reply(
      event.replyToken,
      [{ type: "text", text: geminiResponse, quoteToken }],
      quickReply
    )
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการประมวลผลไฟล์เสียง:", error)
    await line.reply(event.replyToken, [
      {
        type: "text",
        text: "เกิดข้อผิดพลาดในการประมวลผลไฟล์เสียง",
        quoteToken,
      },
    ])
  }
}

// ฟังก์ชันสำหรับจัดการข้อความประเภท Location
const handleLocationMessage = async (event, quoteToken, quickReply) => {
  const { latitude, longitude, address } = event.message
  const apiKey = "a15ac9f5-48e1-45f0-962a-81bb4af574c9" // **ควรย้ายไปเก็บใน Environment Variable**
  const apiUrl = `http://api.airvisual.com/v2/nearest_city?lat=${latitude}&lon=${longitude}&key=${apiKey}`
  try {
    const response = await fetch(apiUrl)
    const data = await response.json()
    if (data.status === "success") {
      const { tp, hu, ws, ic, pr } = data.data.current.weather
      const { aqius: aqi, maincn } = data.data.current.pollution
      let message = `📍 สถานที่: ${address}\n`
      message += `🌏 พิกัด: ${latitude}, ${longitude}\n`
      message += `☁️ สภาพอากาศ: ${ic}\n`
      message += `🌡️ อุณหภูมิ: ${tp}°C\n`
      message += `💧 ความชื้น: ${hu}%\n`
      message += `💨 ความเร็วลม: ${ws} m/s\n`
      message += `🌀 ความกดอากาศ: ${pr} hPa\n\n`
      message += `🍃 คุณภาพอากาศ:\n`
      message += `AQI: ${aqi} (${getAQIDescription(aqi)})\n`
      message += `มลพิษทางอากาศหลัก: ${maincn}\n\n`
      message += `ข้อมูลเพิ่มเติมเกี่ยวกับ AQI:\n`
      message += `- ${getAQIInfo(aqi)}\n`
      await line.reply(
        event.replyToken,
        [{ type: "text", text: message, quoteToken }],
        quickReply
      )
    } else {
      throw new Error(
        "IQAir API returned an error: " + JSON.stringify(data.data)
      )
    }
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการดึงข้อมูลสภาพอากาศ:", error)
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
}

// ฟังก์ชันสำหรับคำอธิบาย AQI
const getAQIDescription = (aqi) => {
  if (aqi <= 50) return "ดี"
  if (aqi <= 100) return "ปานกลาง"
  if (aqi <= 150) return "มีผลกระทบต่อกลุ่มเสี่ยง"
  if (aqi <= 200) return "ไม่ดีต่อสุขภาพ"
  if (aqi <= 300) return "แย่มาก"
  return "อันตราย"
}

// ฟังก์ชันสำหรับให้ข้อมูลเพิ่มเติมเกี่ยวกับ AQI
const getAQIInfo = (aqi) => {
  if (aqi <= 50) return "คุณภาพอากาศดีมาก เหมาะสำหรับการทำกิจกรรมกลางแจ้ง"
  if (aqi <= 100)
    return "คุณภาพอากาศปานกลาง ควรระมัดระวังสำหรับผู้ที่มีความไวต่อมลพิษทางอากาศ"
  if (aqi <= 150)
    return "คุณภาพอากาศเริ่มมีผลกระทบต่อสุขภาพ ผู้ป่วยโรคหัวใจและระบบทางเดินหายใจควรหลีกเลี่ยงการทำกิจกรรมกลางแจ้ง"
  if (aqi <= 200)
    return "คุณภาพอากาศไม่ดีต่อสุขภาพ ควรลดระยะเวลาการทำกิจกรรมกลางแจ้ง"
  if (aqi <= 300) return "คุณภาพอากาศแย่มาก หลีกเลี่ยงการทำกิจกรรมกลางแจ้ง"
  return "คุณภาพอากาศอันตราย งดการทำกิจกรรมกลางแจ้ง"
}

// --- ส่วนที่ 4: Express App และ Webhook Handler ---
const app = express()

// Middleware เพื่อให้ Express สามารถ Parse JSON body ที่ LINE ส่งมาได้
// LINE อาจไม่ได้ส่ง Content-Type ที่ถูกต้องเสมอไป การไม่ระบุ type จะยืดหยุ่นกว่า
app.use(express.json())

// สร้าง Route สำหรับ LINE Webhook
app.post("/webhook", async (req, res) => {
  const events = req.body.events
  if (!events || !Array.isArray(events)) {
    return res.status(400).send("Invalid event format")
  }

  // ประมวลผลทุก event แบบ Asynchronous
  // เราจะไม่รอให้การประมวลผลเสร็จสิ้น แต่จะตอบ 200 OK กลับไปให้ LINE ทันที
  Promise.all(
    events.map(async (event) => {
      const userId = event.source.userId
      console.log("Processing event for User ID: ", userId)
      try {
        if (event.type === "memberJoined") {
          await sendWelcomeMessage(event)
        } else if (event.type === "follow") {
          await sendWelcomeFlex(event, userId)
        } else if (event.type === "message") {
          const prompt = event.message.text?.trim() || ""
          if (prompt === "ข้อมูลระบบ") {
            const systemInfo = getSystemInfo()
            const systemFlex = createSystemInfoFlex(systemInfo)
            await line.reply(event.replyToken, [systemFlex])
          } else if (prompt === "คู่มือการใช้งาน") {
            await line.reply(event.replyToken, [manualChatbot])
          } else {
            const quoteToken = event.message.quoteToken
            await handleMessage(event, userId, prompt, quoteToken)
          }
        }
      } catch (error) {
        console.error("Error processing event:", error)
      }
    })
  ).catch((err) => {
    console.error("Error in Promise.all execution:", err)
  })

  // ตอบกลับ LINE ทันทีด้วย 200 OK เพื่อแจ้งว่าได้รับ event แล้ว
  res.status(200).send("OK")
})

// --- ส่วนที่ 5: Export Handler สำหรับ AWS Lambda และ Server สำหรับ Local Development ---

// ตรวจสอบว่าไม่ได้รันบน Lambda เพื่อเปิดเซิร์ฟเวอร์สำหรับทดสอบบนเครื่อง
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => {
    console.log(
      `✅ Server is running for local development on http://localhost:${PORT}`
    )
    console.log("➡️  Webhook endpoint: http://localhost:3000/webhook")
    console.log(
      "💡 Use ngrok to expose this port to the internet for LINE Webhook testing."
    )
  })
}

// Export Express app ที่ถูกหุ้มด้วย serverless-http เพื่อให้ทำงานบน Lambda ได้
export const handler = serverless(app)
