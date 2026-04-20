declare module "heic-convert" {
  type ConvertArgs = {
    buffer: Uint8Array | ArrayBuffer | Buffer;
    format: "JPEG" | "PNG";
    quality?: number;
  };
  const convert: (args: ConvertArgs) => Promise<ArrayBuffer>;
  export default convert;
}
