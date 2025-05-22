/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {extend: {
      fontFamily: {
        heading: ['Anton', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      colors: {
        industrial: '#1a1a1a',
        concrete: '#2c2c2c',
        steel: '#3f3f3f',
        bone: '#f4f4f4',
      },
    },
  },
    plugins: [],
  }
  