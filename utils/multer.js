const { upload } = require("../config/cloudinary");

router.post("/", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const recipe = new Recipe({
      title: req.body.title,
      description: req.body.description,
      ingredients: JSON.parse(req.body.ingredients),
      steps: JSON.parse(req.body.steps),
      imageUrl: req.file?.path,     // Cloudinary gives a URL here
      author: req.user.id,
    });
    await recipe.save();
    res.json(recipe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) return res.status(404).json({ msg: "Not found" });

    recipe.title = req.body.title;
    recipe.description = req.body.description;
    recipe.ingredients = JSON.parse(req.body.ingredients);
    recipe.steps = JSON.parse(req.body.steps);
    if (req.file) recipe.imageUrl = req.file.path;

    await recipe.save();
    res.json(recipe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
