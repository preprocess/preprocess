// A stand-in for a customer agent Worker. It is uploaded into the stage's
// dispatch namespace and reached only through the API's DISPATCHER binding.
export default {
  fetch() {
    return Response.json({ handledBy: "user-worker" });
  },
} satisfies ExportedHandler;
