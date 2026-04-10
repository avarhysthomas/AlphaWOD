import * as htmlToImage from "html-to-image";

const dataUrlCache = new Map<string, Promise<string>>();

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to convert blob to data URL"));
    };

    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

async function toDataUrl(src: string) {
  if (src.startsWith("data:")) {
    return src;
  }

  const cached = dataUrlCache.get(src);
  if (cached) {
    return cached;
  }

  const promise = fetch(src, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch export image: ${src}`);
      }

      return response.blob();
    })
    .then(blobToDataUrl);

  dataUrlCache.set(src, promise);
  return promise;
}

async function waitForImage(img: HTMLImageElement) {
  if ("decode" in img) {
    try {
      await img.decode();
    } catch {
      // Safari can reject decode for already-complete images. Fall through to load check.
    }
  }

  if (img.complete && img.naturalWidth > 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const done = () => {
      img.removeEventListener("load", done);
      img.removeEventListener("error", done);
      resolve();
    };

    img.addEventListener("load", done);
    img.addEventListener("error", done);
  });
}

export async function prepareNodeImagesForExport(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img")).filter(
    (img) => img.dataset.exportSkip !== "true"
  );

  await Promise.all(
    images.map(async (img) => {
      const src = img.currentSrc || img.src;

      if (src && !src.startsWith("data:")) {
        try {
          const dataUrl = await toDataUrl(src);
          if (img.src !== dataUrl) {
            img.src = dataUrl;
          }
        } catch (error) {
          console.warn("Failed to inline image for export", error);
        }
      }

      await waitForImage(img);
    })
  );

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

type ExportNodeToPngOptions = {
  logoOpacity?: number;
};

export async function exportNodeToPng(
  root: HTMLElement,
  options: ExportNodeToPngOptions = {}
) {
  await prepareNodeImagesForExport(root);

  const canvas = await htmlToImage.toCanvas(root, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: "transparent",
    filter: (node) => {
      return !(
        node instanceof HTMLElement && node.dataset.exportSkip === "true"
      );
    },
  });

  const logoOpacity = options.logoOpacity ?? 0;

  if (logoOpacity > 0) {
    try {
      const logoSrc = await toDataUrl("/ZERO-ALPHA.png");
      const logo = await loadImage(logoSrc);
      const context = canvas.getContext("2d");

      if (context) {
        const logoWidth = canvas.width * (600 / 720);
        const logoHeight = canvas.width * (400 / 720);
        const x = (canvas.width - logoWidth) / 2;
        const y = canvas.height * 0.58 - logoHeight / 2;

        context.save();
        context.globalAlpha = logoOpacity;
        context.drawImage(logo, x, y, logoWidth, logoHeight);
        context.restore();
      }
    } catch (error) {
      console.warn("Failed to paint logo onto export canvas", error);
    }
  }

  return canvas.toDataURL("image/png");
}
