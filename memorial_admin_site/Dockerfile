FROM node:16-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG REACT_APP_APP_SERVER_ENTRY=http://localhost:4033
ARG REACT_APP_RMS_ENTRY=http://localhost:4034
ENV REACT_APP_APP_SERVER_ENTRY=$REACT_APP_APP_SERVER_ENTRY
ENV REACT_APP_RMS_ENTRY=$REACT_APP_RMS_ENTRY
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/build /usr/share/nginx/html
EXPOSE 80

