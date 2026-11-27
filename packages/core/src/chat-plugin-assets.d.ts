// Библиотека графиков встроенного плагина чатов (#595): вписывается в страницу отрисовщика
// целиком, текстом — сети у рамки нет.
declare module "echarts/dist/echarts.min.js" {
  const text: string
  export default text
}
