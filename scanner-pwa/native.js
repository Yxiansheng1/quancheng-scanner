/* 只在「装到手机上的那个 App」里才会被加载。
 * 浏览器里 window.Capacitor 不存在，app.js 根本不会 import 这个文件。
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { TextRecognition, Script } from '@capacitor-mlkit/text-recognition';

export const isNative = Capacitor.isNativePlatform();

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.onerror = () => reject(new Error('读取文件失败'));
    fr.readAsDataURL(blob);
  });
}

/**
 * 把一页图片写到缓存目录，交给 ML Kit 识别。
 * @returns {Promise<{text: string, blocks: any[]}>}
 */
export async function recognize(blob, name = 'page.jpg') {
  const data = await blobToBase64(blob);
  const path = `ocr/${name}`;
  await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Cache,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  const result = await TextRecognition.processImage({ path: uri, script: Script.Chinese });
  return result;
}

/**
 * 写文件到缓存并把系统分享面板调起来（存到「文件」、发微信、发邮件都行）。
 */
export async function shareBlob(blob, filename) {
  const data = await blobToBase64(blob);
  const path = `out/${filename}`;
  await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Cache,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await Share.share({
    title: filename,
    url: uri,
    dialogTitle: '保存或分享',
  });
}

/** 清掉临时文件，别让缓存越攒越大 */
export async function cleanupTemp() {
  try {
    await Filesystem.rmdir({ path: 'ocr', directory: Directory.Cache, recursive: true });
  } catch {}
}
