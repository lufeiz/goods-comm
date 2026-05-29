<script>
export default {
  onLaunch() {
    // App launch hook kept for future platform-specific bootstrap.
  }
}
</script>

<style>
page {
  min-height: 100%;
  background: #f5f7f2;
  color: #17231c;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif;
}

view,
text,
input,
textarea,
button {
  box-sizing: border-box;
}

button {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  border-radius: 8rpx;
  line-height: 1;
  text-align: center;
}

button::after {
  border: 0;
}
</style>
