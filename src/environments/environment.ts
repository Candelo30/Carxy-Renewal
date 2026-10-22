export const environment = {
  production: false,
  brand: {
    name: 'CARXY',
    product: '3D STUDIO',
    description: 'Crea, visualiza y edita escenas 3D en tu navegador.',
  },
  uploads: {
    maxModelBytes: 100 * 1024 * 1024,
    maxThumbnailBytes: 8 * 1024 * 1024,
    modelContentType: 'model/gltf-binary',
    thumbnailContentType: 'image/png',
  },
};
