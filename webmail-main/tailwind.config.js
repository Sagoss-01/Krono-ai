/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./views/**/*.ejs', './public/js/**/*.js'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: { extend: {} },
  plugins: [require('daisyui')],
  daisyui: { themes: ['dark', 'light'], darkTheme: 'dark' }
}
