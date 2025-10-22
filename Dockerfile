# Serve your static site with Nginx
FROM nginx:alpine

# (Optional) leaner image: remove default nginx page
RUN rm -rf /usr/share/nginx/html/*

# Copy your app (index.html, style.css, script.js, assets, etc.)
COPY . /usr/share/nginx/html

# Container listens on 80 by default
EXPOSE 80
